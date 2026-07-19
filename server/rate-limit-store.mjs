/**
 * Shared fixed-window rate-limit storage.
 *
 * With RATE_LIMIT_REDIS_URL configured, every application instance uses Redis
 * and a single atomic Lua operation. Without it, the single-instance in-memory
 * fallback preserves local development behaviour.
 */
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { logger } from "./logger.mjs";

const localBuckets = new Map();
const redisUrl =
  process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL || "";
const keyPrefix =
  process.env.RATE_LIMIT_REDIS_PREFIX || "opencode-ui:rate-limit:";
const connectTimeoutMs = Number(
  process.env.RATE_LIMIT_REDIS_TIMEOUT_MS || 1000,
);

// INCR + PEXPIRE must be atomic: otherwise two instances can both see a new
// key and accidentally reset its expiry. The script returns [count, ttlMs].
const TAKE_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "return {count, ttl}",
].join("\n");

function encodeCommand(parts) {
  return `*${parts.length}\r\n${parts
    .map((part) => {
      const value = String(part);
      return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
    })
    .join("")}`;
}

function parseReply(buffer) {
  const prefix = buffer[0];
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd === -1) return null;
  if (prefix === "+" || prefix === ":")
    return {
      value: Number.isNaN(Number(buffer.slice(1, lineEnd)))
        ? buffer.slice(1, lineEnd)
        : Number(buffer.slice(1, lineEnd)),
      consumed: lineEnd + 2,
    };
  if (prefix === "-")
    throw new Error(`Redis error: ${buffer.slice(1, lineEnd)}`);
  if (prefix === "$") {
    const length = Number(buffer.slice(1, lineEnd));
    if (length === -1) return { value: null, consumed: lineEnd + 2 };
    const end = lineEnd + 2 + length + 2;
    if (buffer.length < end) return null;
    return {
      value: buffer.slice(lineEnd + 2, lineEnd + 2 + length),
      consumed: end,
    };
  }
  if (prefix === "*") {
    const count = Number(buffer.slice(1, lineEnd));
    if (count === -1) return { value: null, consumed: lineEnd + 2 };
    let offset = lineEnd + 2;
    const value = [];
    for (let i = 0; i < count; i += 1) {
      const item = parseReply(buffer.slice(offset));
      if (!item) return null;
      value.push(item.value);
      offset += item.consumed;
    }
    return { value, consumed: offset };
  }
  throw new Error("Invalid Redis RESP reply");
}

function redisCommand(parts) {
  const url = new URL(redisUrl);
  const secure = url.protocol === "rediss:";
  const port = Number(url.port || (secure ? 6380 : 6379));
  const options = { host: url.hostname, port, servername: url.hostname };
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect(options) : net.connect(options);
    let raw = "";
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Redis rate-limit connection timed out")),
      connectTimeoutMs,
    );
    socket.setEncoding("utf8");
    socket.once("error", (err) => finish(err));
    socket.on("data", (chunk) => {
      raw += chunk;
      try {
        const parsed = parseReply(raw);
        if (parsed) finish(null, parsed.value);
      } catch (err) {
        finish(err);
      }
    });
    socket.once(secure ? "secureConnect" : "connect", () => {
      const password = decodeURIComponent(url.password || "");
      const username = decodeURIComponent(url.username || "");
      const command = password
        ? ["AUTH", ...(username ? [username] : []), password, ...parts]
        : parts;
      // AUTH and EVAL cannot be sent as one Redis command. Authenticate first
      // when credentials are URL-encoded into REDIS_URL.
      if (!password) {
        socket.write(encodeCommand(parts));
        return;
      }
      socket.write(
        encodeCommand(
          username ? ["AUTH", username, password] : ["AUTH", password],
        ),
      );
      let authenticated = false;
      socket.removeAllListeners("data");
      socket.on("data", (chunk) => {
        raw += chunk;
        try {
          const parsed = parseReply(raw);
          if (!parsed) return;
          if (!authenticated) {
            if (parsed.value !== "OK") throw new Error("Redis AUTH failed");
            authenticated = true;
            raw = raw.slice(parsed.consumed);
            socket.write(encodeCommand(parts));
            return;
          }
          finish(null, parsed.value);
        } catch (err) {
          finish(err);
        }
      });
    });
  });
}

// LRU-лимит in-memory хранилища: защищает от OOM при флуде с поддельными
// IP: не более 10 тысяч ключей, самые давно использованные вытесняются первыми.
const LOCAL_BUCKETS_MAX = 10_000;

function localTake(key, { limit, windowMs }) {
  const now = Date.now();
  let record = localBuckets.get(key);
  // LRU: повторная вставка перемещает ключ в хвост Map — первые ключи
  // при итерации всегда самые давно не использованные.
  if (record) localBuckets.delete(key);
  if (!record || now - record.start >= windowMs) {
    record = { count: 0, start: now };
  }
  localBuckets.set(key, record);
  record.count += 1;
  if (localBuckets.size > LOCAL_BUCKETS_MAX) {
    // Сначала чистим истёкшие окна, затем вытесняем самые старые (LRU).
    for (const [bucketKey, bucket] of localBuckets) {
      if (localBuckets.size <= LOCAL_BUCKETS_MAX) break;
      if (now - bucket.start >= windowMs) localBuckets.delete(bucketKey);
    }
    while (localBuckets.size > LOCAL_BUCKETS_MAX) {
      const oldestKey = localBuckets.keys().next().value;
      if (oldestKey === undefined) break;
      localBuckets.delete(oldestKey);
    }
  }
  const retryAfterSec =
    record.count > limit
      ? Math.max(1, Math.ceil((windowMs - (now - record.start)) / 1000))
      : 0;
  return {
    allowed: record.count <= limit,
    remaining: Math.max(0, limit - record.count),
    retryAfterSec,
  };
}

function storageKey(key) {
  // Do not expose user emails, IP addresses, or route names in Redis keyspace.
  // A deterministic digest still lets every replica address the same bucket.
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return `${keyPrefix}${digest}`;
}

/** Returns a shared, fixed-window decision. */
export async function takeRateLimit(key, { limit, windowMs }) {
  if (!redisUrl) return localTake(key, { limit, windowMs });
  try {
    const result = await redisCommand([
      "EVAL",
      TAKE_SCRIPT,
      1,
      storageKey(key),
      windowMs,
    ]);
    const [count, ttlMs] = result.map(Number);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: count > limit ? Math.max(1, Math.ceil(ttlMs / 1000)) : 0,
    };
  } catch (error) {
    // A configured shared store must not silently degrade into per-instance
    // limiting. Return unavailable so callers can fail closed with 503.
    logger.error({ err: error.message }, "Redis rate-limit store unavailable");
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: 1,
      unavailable: true,
    };
  }
}

/**
 * Clear one bucket after a successful authentication flow. In Redis mode this
 * invalidates the shared key for every replica; in local mode it preserves the
 * convenient development behaviour.
 */
export async function resetRateLimitKey(key) {
  if (!redisUrl) {
    localBuckets.delete(key);
    return;
  }
  try {
    await redisCommand(["DEL", storageKey(key)]);
  } catch (error) {
    // Authentication itself already succeeded. Do not turn a successful login
    // into a failure merely because this best-effort cleanup timed out.
    logger.warn({ err: error.message }, "Redis rate-limit reset unavailable");
  }
}

export function resetRateLimitStore() {
  localBuckets.clear();
}

export function getRateLimitStoreMode() {
  return redisUrl ? "redis" : "memory";
}
