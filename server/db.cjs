/**
 * Database/persistence layer with synchronous writes.
 * All critical data (users, sessions, owners) is written synchronously
 * to prevent data loss on crash.
 */
const fs = require("fs");
const path = require("path");

// In-memory cache for fast reads
const dbCache = new Map();

/**
 * Load JSON file from disk with caching.
 * Returns cached value if available, otherwise reads from disk.
 */
function loadJson(file, def = {}) {
  if (dbCache.has(file)) return dbCache.get(file);
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
 * Save JSON file synchronously (no write-behind delay).
 * Critical for auth data that must not be lost on crash.
 */
function saveJson(file, data) {
  dbCache.set(file, data);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`[DB] Failed to save ${file}:`, e.message);
  }
}

/**
 * Alias for saveJson — used in auth-related code paths for clarity.
 */
function saveAuthJson(file, data) {
  saveJson(file, data);
}

/**
 * Clear the in-memory cache (useful for testing).
 */
function clearCache() {
  dbCache.clear();
}

module.exports = {
  loadJson,
  saveJson,
  saveAuthJson,
  clearCache,
};
