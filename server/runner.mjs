/**
 * runner.mjs — изоляция «новый чат = новый контейнер».
 *
 * Каждая сессия получает собственный Docker-контейнер (образ opencode-runner)
 * с отдельным экземпляром `opencode serve` внутри. В контейнер монтируется
 * ТОЛЬКО каталог этой сессии (<HOST_WORKSPACE_DIR>/sessions/<sid> -> /session).
 * Агент физически не видит ни процессы платформы, ни чужие сессии:
 * даже `pkill -9 -f node` внутри контейнера убивает только его собственные
 * процессы.
 *
 * Включается флагом RUNNER_ISOLATION=1. При выключенном флаге поведение
 * прежнее (один системный opencode + ?directory=). Старые сессии, созданные
 * до включения флага, не имеют записи в реестре и продолжают обслуживаться
 * системным инстансом (graceful-миграция).
 *
 * Реестр: <WORKDIR>/.session_runners.json
 *   { "<sid>": { container, createdAt, lastUsed, lastInfo, ports } }
 *
 * Инварианты изоляции сохранены:
 *  1. Каждая сессия работает строго в своём каталоге sessions/<sid>/workspace
 *     (в контейнере он всегда виден как /session/workspace).
 *  2. Глобальные маршруты никогда не попадают в раннеры.
 *  3. tmp_* не являются валидными ID сессий (isValidSessionId).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WORKDIR } from "./config.mjs";
import { isValidSessionId } from "./isolation.mjs";
import { logger } from "./logger.mjs";

export const RUNNERS_ENABLED = process.env.RUNNER_ISOLATION === "1";
export const RUNNER_PORT = 4096;
export const RUNNER_SESSION_MOUNT = "/session";
export const RUNNER_WORKSPACE = "/session/workspace";

const RUNNER_IMAGE = process.env.RUNNER_IMAGE || "opencode-runner:latest";
const RUNNER_NETWORK = process.env.RUNNER_NETWORK || "opencode-runners";
const RUNNER_MEMORY = process.env.RUNNER_MEMORY || "1536m";
// Свап отключён: memory-swap == memory означает «памяти + 0 свапа».
const RUNNER_MEMORY_SWAP = process.env.RUNNER_MEMORY_SWAP || RUNNER_MEMORY;
const RUNNER_CPUS = process.env.RUNNER_CPUS || "1";
// Процессы раннера не работают из-под root (node:24-slim => node = 1000:1000).
const RUNNER_USER = process.env.RUNNER_USER || "1000:1000";
const RUNNER_PIDS_LIMIT = process.env.RUNNER_PIDS_LIMIT || "512";
const RUNNER_IDLE_STOP_MS =
  (parseInt(process.env.RUNNER_IDLE_STOP_MIN || "", 10) || 30) * 60 * 1000;
// Порты приложений пользователя (например, WS-сервер игры на 3001),
// публикуются на случайные хост-порты: см. getRunnerInfo().ports.
const RUNNER_PUBLISH_PORTS = (process.env.RUNNER_PUBLISH_PORTS || "3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Порты приложений публикуются только на loopback хоста: наружу их
// отдаёт reverse-proxy/SSH-туннель, а не docker напрямую в интернет.
const RUNNER_PUBLISH_HOST = process.env.RUNNER_PUBLISH_HOST || "127.0.0.1";
// Абсолютный ХОСТОВЫЙ путь каталога, который в контейнере proxy смонтирован
// как WORKDIR. Нужен, потому что docker run -v принимает пути хоста.
const HOST_WORKSPACE_DIR = process.env.HOST_WORKSPACE_DIR || "";

const REGISTRY_FILE = path.join(WORKDIR, ".session_runners.json");

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveRegistry(reg) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
  } catch (e) {
    logger.error({ err: e.message }, "[runner] registry save failed");
  }
}

function requireHostDir() {
  if (!HOST_WORKSPACE_DIR || !path.isAbsolute(HOST_WORKSPACE_DIR)) {
    throw new Error(
      "HOST_WORKSPACE_DIR is not set (absolute host path of the workspace bind mount is required for RUNNER_ISOLATION=1)",
    );
  }
}

export function containerName(sid) {
  if (!isValidSessionId(sid)) throw new Error(`Invalid session ID: ${sid}`);
  return `oc-ses-${sid}`;
}

export function runnerTarget(sid) {
  return `http://${containerName(sid)}:${RUNNER_PORT}`;
}

export function hasRunner(sid) {
  if (!isValidSessionId(sid)) return false;
  return Boolean(loadRegistry()[sid]);
}

function docker(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`docker ${args[0]} failed: ${stderr || err.message}`),
          );
        } else {
          resolve(String(stdout));
        }
      },
    );
  });
}

async function containerState(name) {
  try {
    const out = await docker([
      "inspect",
      "--format",
      "{{.State.Status}}",
      name,
    ]);
    return out.trim(); // running | exited | created | ...
  } catch {
    return null; // контейнера нет
  }
}

function healthCheck(host, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const r = http.get(
      {
        hostname: host,
        port: RUNNER_PORT,
        path: "/global/health",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    r.on("error", () => resolve(false));
    r.on("timeout", () => {
      r.destroy();
      resolve(false);
    });
  });
}

async function waitHealthy(name, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck(name, 1200)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`runner ${name} did not become healthy in ${timeoutMs}ms`);
}

async function publishedPorts(name) {
  try {
    const out = await docker(["port", name]);
    const ports = {};
    for (const line of out.split("\n")) {
      // "3001/tcp -> 0.0.0.0:32768"
      const m = line.match(/^(\d+)\/tcp\s*->\s*[\d.:\[\]a-fA-F]*:(\d+)$/);
      if (m) ports[m[1]] = parseInt(m[2], 10);
    }
    return ports;
  } catch {
    return {};
  }
}

function runnerEnvArgs() {
  const args = [];
  const env = {
    OPENCODE_ZEN_API_KEY: process.env.OPENCODE_ZEN_API_KEY || "",
    OPENCODE_MODEL: process.env.OPENCODE_MODEL || "",
    UI_API_BASE: "http://opencode-ui:3000",
    // Единая таймзона для таймстемпов и бэкапов независимо от хоста/ДЦ.
    TZ: process.env.TZ || "UTC",
  };
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  return args;
}

// Рекурсивный chown каталога сессии на пользователя раннера. Каталоги
// создаёт прокси (root), а контейнер работает из-под RUNNER_USER — без
// смены владельца не-root раннер не сможет писать в /session.
function chownRecursive(dir, uid, gid) {
  try {
    fs.lchownSync(dir, uid, gid);
  } catch {}
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chownRecursive(p, uid, gid);
    } else {
      try {
        fs.lchownSync(p, uid, gid);
      } catch {}
    }
  }
}

function chownForRunner(localSessionDir) {
  const [uidRaw, gidRaw] = RUNNER_USER.split(":");
  const uid = parseInt(uidRaw, 10);
  const gid = parseInt(gidRaw, 10);
  if (!localSessionDir || !Number.isInteger(uid)) return;
  chownRecursive(localSessionDir, uid, Number.isInteger(gid) ? gid : uid);
}

async function runRunnerContainer(name, hostSessionDir, localSessionDir) {
  requireHostDir();
  chownForRunner(localSessionDir);
  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    RUNNER_NETWORK,
    "--memory",
    RUNNER_MEMORY,
    "--memory-swap",
    RUNNER_MEMORY_SWAP,
    "--cpus",
    RUNNER_CPUS,
    "--user",
    RUNNER_USER,
    "--pids-limit",
    RUNNER_PIDS_LIMIT,
    "--security-opt",
    "no-new-privileges",
    "--restart",
    "no",
    "-v",
    `${hostSessionDir}:${RUNNER_SESSION_MOUNT}`,
    ...runnerEnvArgs(),
  ];
  for (const p of RUNNER_PUBLISH_PORTS)
    args.push("-p", `${RUNNER_PUBLISH_HOST}::${p}`);
  args.push(RUNNER_IMAGE);
  await docker(args, 60000);
}

function hostSessionDir(sid) {
  requireHostDir();
  return path.posix.join(HOST_WORKSPACE_DIR, "sessions", sid);
}

function touch(sid) {
  const reg = loadRegistry();
  if (reg[sid]) {
    reg[sid].lastUsed = Date.now();
    saveRegistry(reg);
  }
}

// Один ensure на сессию одновременно (защита от параллельного docker start).
const inflight = new Map();

export function ensureRunner(sid) {
  if (!isValidSessionId(sid))
    return Promise.reject(new Error(`Invalid session ID: ${sid}`));
  if (inflight.has(sid)) return inflight.get(sid);
  const p = ensureRunnerInner(sid).finally(() => inflight.delete(sid));
  inflight.set(sid, p);
  return p;
}

async function ensureRunnerInner(sid) {
  const name = containerName(sid);
  if (await healthCheck(name, 800)) {
    touch(sid);
    return name;
  }
  const state = await containerState(name);
  if (state === "running") {
    await waitHealthy(name);
  } else if (state) {
    logger.info({ sid }, "[runner] starting stopped container");
    try {
      await docker(["start", name]);
      await waitHealthy(name);
    } catch (startErr) {
      logger.warn(
        { sid, err: startErr.message },
        "[runner] start failed, recreating container",
      );
      await docker(["rm", "-f", name]).catch(() => {});
      const sessDir = path.join(WORKDIR, "sessions", sid);
      if (!fs.existsSync(sessDir)) {
        throw new Error(`session directory missing for ${sid}`);
      }
      await runRunnerContainer(name, hostSessionDir(sid), sessDir);
      await waitHealthy(name);
    }
  } else {
    // Контейнера нет (перезагрузка хоста / docker system prune) — пересоздаём
    // из каталога сессии. Данные сессии живут на диске, ничего не теряется.
    const sessDir = path.join(WORKDIR, "sessions", sid);
    if (!fs.existsSync(sessDir)) {
      throw new Error(`session directory missing for ${sid}`);
    }
    logger.info({ sid }, "[runner] (re)creating container");
    await runRunnerContainer(name, hostSessionDir(sid), sessDir);
    await waitHealthy(name);
  }
  const reg = loadRegistry();
  reg[sid] = { ...(reg[sid] || {}), container: name, lastUsed: Date.now() };
  reg[sid].ports = await publishedPorts(name);
  saveRegistry(reg);
  return name;
}

function httpJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => {
        data += c;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy(new Error("timeout"));
      });
    }
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Новый чат = новый контейнер.
 * 1. Временный каталог sessions/_new-* монтируется в одноразовый контейнер.
 * 2. В нём создаётся opencode-сессия (directory=/session/workspace) -> sid.
 * 3. Контейнер останавливается, каталог переименовывается в sessions/<sid>,
 *    поднимается постоянный контейнер oc-ses-<sid>.
 * Путь внутри контейнера всегда /session/workspace, поэтому переименование
 * каталога на хосте не ломает состояние opencode.
 */
export async function createSessionInNewRunner(rawBody) {
  requireHostDir();
  const tmpId = `_new-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpName = `oc-new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tmpDir = path.join(WORKDIR, "sessions", tmpId);
  fs.mkdirSync(path.join(tmpDir, "workspace", "uploads"), { recursive: true });

  try {
    await runRunnerContainer(
      tmpName,
      path.posix.join(HOST_WORKSPACE_DIR, "sessions", tmpId),
      tmpDir,
    );
    await waitHealthy(tmpName);

    const resp = await httpJson(
      {
        hostname: tmpName,
        port: RUNNER_PORT,
        path: `/session?directory=${encodeURIComponent(RUNNER_WORKSPACE)}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(rawBody || ""),
        },
        timeout: 30000,
      },
      rawBody || "",
    );
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw new Error(
        `session create HTTP ${resp.statusCode}: ${resp.body.slice(0, 200)}`,
      );
    }
    const session = JSON.parse(resp.body);
    const sid = session?.id;
    if (!sid || !isValidSessionId(sid)) {
      throw new Error(`invalid session id in response: ${String(sid)}`);
    }

    // Останавливаем одноразовый контейнер и переезжаем на постоянный.
    await docker(["rm", "-f", tmpName]).catch(() => {});
    const finalDir = path.join(WORKDIR, "sessions", sid);
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpDir, finalDir);

    const name = containerName(sid);
    await docker(["rm", "-f", name]).catch(() => {});
    await runRunnerContainer(name, hostSessionDir(sid), finalDir);
    await waitHealthy(name);

    const reg = loadRegistry();
    reg[sid] = {
      container: name,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      lastInfo: session,
      ports: await publishedPorts(name),
    };
    saveRegistry(reg);
    logger.info({ sid, container: name }, "[runner] session container ready");
    return session;
  } catch (e) {
    // Полная уборка при любой ошибке.
    await docker(["rm", "-f", tmpName]).catch(() => {});
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    throw e;
  }
}

/** Список сессий из реестра (для сайдбара). Живые раннеры опрашиваются,
 *  для остановленных возвращается кэш lastInfo. */
export async function listRunnerSessions() {
  const reg = loadRegistry();
  const sids = Object.keys(reg);
  const results = await Promise.allSettled(
    sids.map(async (sid) => {
      const name = reg[sid].container || containerName(sid);
      if (await healthCheck(name, 700)) {
        const resp = await httpJson({
          hostname: name,
          port: RUNNER_PORT,
          path: "/session",
          method: "GET",
          timeout: 1500,
        });
        const arr = JSON.parse(resp.body);
        const info = Array.isArray(arr)
          ? arr.find((s) => s.id === sid) || arr[0]
          : null;
        if (info) return { sid, info };
      }
      return { sid, info: reg[sid].lastInfo || null };
    }),
  );
  const sessions = [];
  const regDirty = loadRegistry();
  let dirty = false;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.info) continue;
    sessions.push(r.value.info);
    if (
      regDirty[r.value.sid] &&
      r.value.info !== regDirty[r.value.sid].lastInfo
    ) {
      regDirty[r.value.sid].lastInfo = r.value.info;
      dirty = true;
    }
  }
  if (dirty) saveRegistry(regDirty);
  return sessions;
}

export async function removeRunner(sid) {
  const name = containerName(sid);
  await docker(["rm", "-f", name]).catch(() => {});
  const reg = loadRegistry();
  delete reg[sid];
  saveRegistry(reg);
  logger.info({ sid }, "[runner] container removed");
}

export async function getRunnerInfo(sid) {
  const reg = loadRegistry();
  const entry = reg[sid];
  if (!entry) return null;
  const name = entry.container || containerName(sid);
  const state = (await containerState(name)) || "absent";
  const ports =
    state === "running" ? await publishedPorts(name) : entry.ports || {};
  return { container: name, state, ports, lastUsed: entry.lastUsed || null };
}

/** Останавливает контейнеры, простаивающие дольше RUNNER_IDLE_STOP_MIN.
 *  Данные не удаляются; при следующем обращении ensureRunner сделает docker start. */
export function startRunnerReaper() {
  setInterval(
    async () => {
      try {
        const reg = loadRegistry();
        const now = Date.now();
        for (const [sid, entry] of Object.entries(reg)) {
          if (now - (entry.lastUsed || 0) < RUNNER_IDLE_STOP_MS) continue;
          const name = entry.container || containerName(sid);
          const state = await containerState(name);
          if (state === "running") {
            logger.info({ sid }, "[runner] stopping idle container");
            await docker(["stop", "-t", "10", name]).catch(() => {});
          }
        }
      } catch (e) {
        logger.warn({ err: e.message }, "[runner] reaper iteration failed");
      }
    },
    5 * 60 * 1000,
  ).unref();
}
