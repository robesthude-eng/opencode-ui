/**
 * Database / persistence layer.
 *
 * Primary store: SQLite (better-sqlite3) at $OPENCODE_WORKDIR/opencode.db
 * Legacy JSON files (.users.json, .sessions.json, .session_owners.json) are
 * auto-migrated once on first open, then left as read-only backups.
 *
 * Public API stays compatible with the old JSON helpers so call sites can
 * keep using loadJson/saveJson with the same file paths.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// In-memory cache for loadJson compatibility (mirrors row data as objects)
const dbCache = new Map();

/** @type {import('better-sqlite3').Database | null} */
let sqlite = null;
let dbPath = null;

const USERS_BASENAME = ".users.json";
const SESSIONS_BASENAME = ".sessions.json";
const OWNERS_BASENAME = ".session_owners.json";

function isAuthFile(file) {
  const base = path.basename(file);
  return base === USERS_BASENAME || base === SESSIONS_BASENAME || base === OWNERS_BASENAME;
}

function openSqlite(workdir) {
  if (sqlite) return sqlite;
  const dir = workdir || process.env.OPENCODE_WORKDIR || "/app/workspace";
  fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, "opencode.db");
  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_owners (
      session_id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
    CREATE INDEX IF NOT EXISTS idx_owners_email ON session_owners(email);
  `);
  return sqlite;
}

/**
 * Initialize SQLite for a workdir and migrate legacy JSON if present.
 * Safe to call multiple times.
 */
export function initDb(workdir) {
  const db = openSqlite(workdir);
  migrateFromJson(workdir || process.env.OPENCODE_WORKDIR || "/app/workspace");
  return db;
}

function migrateFromJson(workdir) {
  if (!sqlite) return;
  const flag = path.join(workdir, ".sqlite_migrated");
  if (fs.existsSync(flag)) return;

  const usersFile = path.join(workdir, USERS_BASENAME);
  const sessionsFile = path.join(workdir, SESSIONS_BASENAME);
  const ownersFile = path.join(workdir, OWNERS_BASENAME);

  const userCount = sqlite.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const sessionCount = sqlite.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
  const ownerCount = sqlite.prepare("SELECT COUNT(*) AS c FROM session_owners").get().c;

  const migrateUsers = userCount === 0 && fs.existsSync(usersFile);
  const migrateSessions = sessionCount === 0 && fs.existsSync(sessionsFile);
  const migrateOwners = ownerCount === 0 && fs.existsSync(ownersFile);

  if (!migrateUsers && !migrateSessions && !migrateOwners) {
    try {
      fs.writeFileSync(flag, new Date().toISOString(), { mode: 0o600 });
    } catch {
      // ignore
    }
    return;
  }

  const tx = sqlite.transaction(() => {
    if (migrateUsers) {
      try {
        const users = JSON.parse(fs.readFileSync(usersFile, "utf8") || "{}");
        const ins = sqlite.prepare(
          "INSERT OR IGNORE INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
        );
        for (const [email, u] of Object.entries(users || {})) {
          if (!u || typeof u !== "object") continue;
          ins.run(
            email.toLowerCase(),
            u.passwordHash || "",
            u.role || "user",
            u.createdAt || Date.now(),
          );
        }
        console.log(`[DB] Migrated ${Object.keys(users || {}).length} users from JSON → SQLite`);
      } catch (e) {
        console.error("[DB] User migration failed:", e.message);
      }
    }
    if (migrateSessions) {
      try {
        const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8") || "{}");
        const ins = sqlite.prepare(
          "INSERT OR IGNORE INTO sessions (token, email, created_at) VALUES (?, ?, ?)",
        );
        for (const [token, s] of Object.entries(sessions || {})) {
          if (!s?.email) continue;
          ins.run(token, s.email, s.createdAt || Date.now());
        }
        console.log(
          `[DB] Migrated ${Object.keys(sessions || {}).length} sessions from JSON → SQLite`,
        );
      } catch (e) {
        console.error("[DB] Session migration failed:", e.message);
      }
    }
    if (migrateOwners) {
      try {
        const owners = JSON.parse(fs.readFileSync(ownersFile, "utf8") || "{}");
        const ins = sqlite.prepare(
          "INSERT OR IGNORE INTO session_owners (session_id, email) VALUES (?, ?)",
        );
        for (const [sid, email] of Object.entries(owners || {})) {
          if (!email) continue;
          ins.run(sid, email);
        }
        console.log(
          `[DB] Migrated ${Object.keys(owners || {}).length} session owners from JSON → SQLite`,
        );
      } catch (e) {
        console.error("[DB] Owners migration failed:", e.message);
      }
    }
  });
  tx();

  try {
    fs.writeFileSync(flag, new Date().toISOString(), { mode: 0o600 });
  } catch {
    // ignore
  }
}

function ensureDbForFile(file) {
  if (sqlite) return;
  // Infer workdir from file path
  const dir = path.dirname(file);
  initDb(dir);
}

function loadUsersObject() {
  const rows = sqlite.prepare("SELECT email, password_hash, role, created_at FROM users").all();
  const out = {};
  for (const r of rows) {
    out[r.email] = {
      email: r.email,
      passwordHash: r.password_hash,
      role: r.role,
      createdAt: r.created_at,
    };
  }
  return out;
}

function saveUsersObject(data) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM users").run();
    const ins = sqlite.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    );
    for (const [email, u] of Object.entries(data || {})) {
      if (!u) continue;
      ins.run(
        email.toLowerCase(),
        u.passwordHash || "",
        u.role || "user",
        u.createdAt || Date.now(),
      );
    }
  });
  tx();
}

function loadSessionsObject() {
  const rows = sqlite.prepare("SELECT token, email, created_at FROM sessions").all();
  const out = {};
  for (const r of rows) {
    out[r.token] = { email: r.email, createdAt: r.created_at };
  }
  return out;
}

function saveSessionsObject(data) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM sessions").run();
    const ins = sqlite.prepare("INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?)");
    for (const [token, s] of Object.entries(data || {})) {
      if (!s?.email) continue;
      ins.run(token, s.email, s.createdAt || Date.now());
    }
  });
  tx();
}

function loadOwnersObject() {
  const rows = sqlite.prepare("SELECT session_id, email FROM session_owners").all();
  const out = {};
  for (const r of rows) {
    out[r.session_id] = r.email;
  }
  return out;
}

function saveOwnersObject(data) {
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM session_owners").run();
    const ins = sqlite.prepare("INSERT INTO session_owners (session_id, email) VALUES (?, ?)");
    for (const [sid, email] of Object.entries(data || {})) {
      if (!email) continue;
      ins.run(sid, email);
    }
  });
  tx();
}

/**
 * Load JSON-shaped data. Auth files are served from SQLite; other files stay on disk.
 */
export function loadJson(file, def = {}) {
  if (dbCache.has(file)) return dbCache.get(file);

  if (isAuthFile(file)) {
    ensureDbForFile(file);
    const base = path.basename(file);
    let data;
    if (base === USERS_BASENAME) data = loadUsersObject();
    else if (base === SESSIONS_BASENAME) data = loadSessionsObject();
    else data = loadOwnersObject();
    dbCache.set(file, data);
    return data;
  }

  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      dbCache.set(file, data);
      return data;
    }
  } catch (e) {
    console.error(`[DB] Failed to load ${file} from disk:`, e.message);
  }
  dbCache.set(file, def);
  return def;
}

/**
 * Save JSON-shaped data. Auth files go to SQLite; other files stay on disk (atomic write).
 */
export function saveJson(file, data) {
  dbCache.set(file, data);

  if (isAuthFile(file)) {
    ensureDbForFile(file);
    const base = path.basename(file);
    if (base === USERS_BASENAME) saveUsersObject(data);
    else if (base === SESSIONS_BASENAME) saveSessionsObject(data);
    else saveOwnersObject(data);
    return;
  }

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, file);
  } catch (e) {
    console.error(`[DB] Failed to save ${file}:`, e.message);
  }
}

/**
 * Alias for saveJson — used in auth-related code paths for clarity.
 */
export function saveAuthJson(file, data) {
  saveJson(file, data);
}

/**
 * Clear the in-memory cache (useful for testing).
 */
export function clearCache() {
  dbCache.clear();
}

/**
 * Close SQLite (tests / graceful shutdown).
 */
export function closeDb() {
  if (sqlite) {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
  }
  sqlite = null;
  dbPath = null;
  dbCache.clear();
}

/**
 * Low-level handle for advanced queries / health.
 */
export function getSqlite() {
  return sqlite;
}
