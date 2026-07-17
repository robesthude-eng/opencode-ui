/**
 * Терминал по Socket.IO поверх настоящего PTY (node-pty).
 *
 * PTY даёт: посимвольное эхо, Ctrl+C/Ctrl+Z (line discipline и сигналы),
 * стрелки/историю/completion в bash, isatty=true (цвета, vim/top/less),
 * корректный размер окна (resize с клиента через FitAddon).
 *
 * node-pty — нативный модуль, поэтому подключается динамически и объявлен
 * в optionalDependencies: если он не собрался/не установлен (например,
 * локальный запуск без тулчейна), терминал деградирует до прежнего
 * pipe-режима (bash -i на пайпах) с предупреждением пользователю,
 * а не роняет сервер.
 *
 * Модель безопасности — зеркалит HTTP/upgrade-гейты из index.mjs:
 *  1. Origin-проверка: только same-origin (или запросы без Origin — не браузер).
 *  2. Auth на уровне handshake (allowRequest, до создания engine.io-сессии):
 *     HttpOnly cookie-токен из .sessions.json с проверкой TTL.
 *  3. Ownership: query.workdir = ID сессии; чужие сессии
 *     (.session_owners.json) → отказ. Инвариант изоляции #2/#3.
 *  4. Shell получает env по белому списку — секреты процесса
 *     (OPENCODE_ZEN_API_KEY и т.п.) в терминал не утекают.
 *  5. Без валидного ID сессии shell не стартует.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { Server as SocketIOServer } from "socket.io";
import { getUserEmail } from "./auth.mjs";
import { OWNERS_FILE, SESSIONS_FILE } from "./config.mjs";
import { loadJson } from "./db.mjs";
import { getSessionWorkspace, isValidSessionId } from "./isolation.mjs";
import { logger } from "./logger.mjs";
import {
  containerName,
  ensureRunner,
  hasRunner,
  RUNNER_WORKSPACE,
  RUNNERS_ENABLED,
} from "./runner.mjs";

// Динамическая загрузка node-pty (optionalDependency, см. docstring).
let ptySpawn = null;
try {
  const mod = await import("node-pty");
  ptySpawn = mod.spawn ?? mod.default?.spawn ?? null;
  if (ptySpawn) logger.info("node-pty loaded: terminal runs in PTY mode");
} catch (e) {
  logger.warn(
    { err: e?.message },
    "node-pty unavailable: terminal falls back to pipe mode",
  );
}

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_ENV",
];

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MIN_DIM = 2;
const MAX_COLS = 500;
const MAX_ROWS = 300;

function buildSafeEnv() {
  const env = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.TERM = "xterm-256color";
  return env;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // не браузер (curl и т.п.) — CSRF-вектора нет
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clampDim(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * Запуск shell в PTY. Возвращает единый интерфейс { write, resize, kill }.
 */
function startPtyShell(socket, workdir) {
  const shell = ptySpawn("bash", [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: workdir,
    env: buildSafeEnv(),
  });

  shell.onData((data) => socket.emit("data", data));
  shell.onExit(({ exitCode, signal }) => {
    socket.emit(
      "data",
      `\r\n\x1b[33m*** shell завершился (${signal || exitCode}) ***\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });

  return {
    write: (data) => shell.write(String(data)),
    resize: (cols, rows) => {
      try {
        shell.resize(cols, rows);
      } catch {
        // resize после смерти процесса — игнорируем
      }
    },
    // Закрытие pty-мастера + SIGHUP лидеру сессии: bash и его foreground-джобы
    // получают HUP штатным для терминалов способом.
    kill: () => {
      try {
        shell.kill();
      } catch {}
    },
  };
}

/**
 * Fallback без PTY: bash -i на пайпах. Ограничения: нет посимвольного эха,
 * не работают Ctrl+C/стрелки/vim, размер фиксирован. Оставлен, чтобы терминал
 * жил и там, где node-pty не собрался.
 */
function startPipeShell(socket, workdir) {
  socket.emit(
    "data",
    "\x1b[33m*** node-pty недоступен: терминал в ограниченном режиме " +
      "(нет Ctrl+C, эха при вводе и интерактивных программ) ***\x1b[0m\r\n",
  );

  // detached → своя process group: при дисконнекте убиваем bash вместе
  // со всеми его детьми (иначе они переживают закрытие вкладки).
  const shell = spawn("bash", ["-i"], {
    cwd: workdir,
    env: buildSafeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  const kill = () => {
    if (!shell.pid) return;
    try {
      process.kill(-shell.pid, "SIGKILL");
    } catch {
      try {
        shell.kill("SIGKILL");
      } catch {}
    }
  };

  shell.on("error", (err) => {
    socket.emit(
      "data",
      `\r\n\x1b[31mОшибка запуска shell: ${err.message}\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });
  shell.on("exit", (code, signal) => {
    socket.emit(
      "data",
      `\r\n\x1b[33m*** shell завершился (${signal || code}) ***\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });

  shell.stdout.on("data", (data) => socket.emit("data", data.toString()));
  shell.stderr.on("data", (data) => socket.emit("data", data.toString()));

  return {
    write: (data) => {
      if (shell.stdin.writable) shell.stdin.write(String(data));
    },
    resize: null, // без pty размер окна передать некому
    kill,
  };
}

/**
 * Терминал внутри контейнера-раннера сессии (RUNNER_ISOLATION=1):
 * docker exec bash. Терминал и процессы агента живут в одном изолированном
 * контейнере — платформа и чужие сессии недостижимы физически.
 */
function dockerExecArgs(sid, withTty) {
  const args = ["exec", "-i"];
  if (withTty) args.push("-t");
  args.push(
    "-w",
    RUNNER_WORKSPACE,
    "-e",
    "TERM=xterm-256color",
    containerName(sid),
    "bash",
  );
  if (!withTty) args.push("-i");
  return args;
}

function startPtyDockerShell(socket, sid) {
  const shell = ptySpawn("docker", dockerExecArgs(sid, true), {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: "/",
    env: buildSafeEnv(),
  });
  shell.onData((data) => socket.emit("data", data));
  shell.onExit(({ exitCode, signal }) => {
    socket.emit(
      "data",
      `\r\n\x1b[33m*** shell завершился (${signal || exitCode}) ***\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });
  return {
    write: (data) => shell.write(String(data)),
    resize: (cols, rows) => {
      try {
        shell.resize(cols, rows);
      } catch {
        // resize после смерти процесса — игнорируем
      }
    },
    kill: () => {
      try {
        shell.kill();
      } catch {}
    },
  };
}

function startPipeDockerShell(socket, sid) {
  socket.emit(
    "data",
    "\x1b[33m*** node-pty недоступен: терминал в ограниченном режиме " +
      "(нет Ctrl+C, эха при вводе и интерактивных программ) ***\x1b[0m\r\n",
  );
  const shell = spawn("docker", dockerExecArgs(sid, false), {
    env: buildSafeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  shell.on("error", (err) => {
    socket.emit(
      "data",
      `\r\n\x1b[31mОшибка запуска shell: ${err.message}\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });
  shell.on("exit", (code, signal) => {
    socket.emit(
      "data",
      `\r\n\x1b[33m*** shell завершился (${signal || code}) ***\x1b[0m\r\n`,
    );
    socket.disconnect(true);
  });
  shell.stdout.on("data", (data) => socket.emit("data", data.toString()));
  shell.stderr.on("data", (data) => socket.emit("data", data.toString()));
  return {
    write: (data) => {
      if (shell.stdin.writable) shell.stdin.write(String(data));
    },
    resize: null,
    kill: () => {
      try {
        shell.kill("SIGKILL");
      } catch {}
    },
  };
}

export function initTerminalServer(httpServer, options = {}) {
  const sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    serveClient: false,
    // index.mjs сам обслуживает не-socket.io upgrade'ы (проксирует в OpenCode);
    // не даём engine.io добивать их по своему 1s-таймауту.
    destroyUpgrade: false,
    // Auth до завершения handshake — и для polling, и для websocket.
    allowRequest: (req, callback) => {
      if (!sameOrigin(req)) return callback("origin not allowed", false);
      if (!getUserEmail(req, SESSIONS_FILE, sessionTtlMs)) {
        return callback("unauthorized", false);
      }
      callback(null, true);
    },
  });

  io.on("connection", async (socket) => {
    const req = socket.request;
    const email = getUserEmail(req, SESSIONS_FILE, sessionTtlMs);

    const fail = (msg) => {
      socket.emit("data", `\r\n\x1b[31m${msg}\x1b[0m\r\n`);
      socket.disconnect(true);
    };

    if (!email) {
      fail("Сессия истекла — войдите заново.");
      return;
    }

    const sid = String(socket.handshake.query.workdir || "");
    if (!isValidSessionId(sid)) {
      fail(
        "Терминал работает внутри чата — откройте или создайте чат и повторите.",
      );
      return;
    }
    const owners = loadJson(OWNERS_FILE, {});
    if (owners[sid] && owners[sid] !== email) {
      fail("Доступ запрещён: этот чат принадлежит другому пользователю.");
      return;
    }

    let workdir;
    try {
      workdir = getSessionWorkspace(sid);
      fs.mkdirSync(workdir, { recursive: true });
    } catch (e) {
      fail(`Не удалось открыть workspace: ${e.message}`);
      return;
    }

    logger.info(
      { socketId: socket.id, sid, email, pty: Boolean(ptySpawn) },
      "Terminal socket connected",
    );

    const useRunner = RUNNERS_ENABLED && hasRunner(sid);
    if (useRunner) {
      try {
        socket.emit("data", "\x1b[90mЗапускаю контейнер сессии…\x1b[0m\r\n");
        await ensureRunner(sid);
      } catch (e) {
        fail(`Не удалось запустить контейнер сессии: ${e.message}`);
        return;
      }
      if (socket.disconnected) return;
    }

    let shell;
    try {
      if (useRunner) {
        shell = ptySpawn
          ? startPtyDockerShell(socket, sid)
          : startPipeDockerShell(socket, sid);
      } else {
        shell = ptySpawn
          ? startPtyShell(socket, workdir)
          : startPipeShell(socket, workdir);
      }
    } catch (e) {
      fail(`Ошибка запуска shell: ${e.message}`);
      return;
    }

    socket.on("data", (data) => shell.write(data));

    socket.on("resize", (size) => {
      if (!shell.resize) return;
      const cols = clampDim(size?.cols, MIN_DIM, MAX_COLS);
      const rows = clampDim(size?.rows, MIN_DIM, MAX_ROWS);
      if (cols === null || rows === null) return;
      shell.resize(cols, rows);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id, sid }, "Terminal socket disconnected");
      shell.kill();
    });
  });

  return io;
}
