import path from "node:path";

export const SYSTEM_PORT = parseInt(process.env.OC_SYSTEM_PORT || "4096", 10);
export const PORT = 3000;
export const WORKDIR = process.env.OPENCODE_WORKDIR || "/app/workspace";
export const USERS_FILE = path.join(WORKDIR, ".users.json");
export const SESSIONS_FILE = path.join(WORKDIR, ".sessions.json");
export const OWNERS_FILE = path.join(WORKDIR, ".session_owners.json");
// Серверные переименования чатов — оверлей поверх заголовков движка,
// синхронизируется между браузерами/устройствами (см. routes/session.mjs).
export const TITLES_FILE = path.join(WORKDIR, ".session_titles.json");
// Настройки пользователя (закреплённые чаты, выбранная модель) — на сервере,
// чтобы синхронизироваться между браузерами (см. routes/prefs.mjs).
export const PREFS_FILE = path.join(WORKDIR, ".user_prefs.json");
export const USER_KEYS_DIR = path.join(WORKDIR, ".user_keys");
// Ровно 4МБ (см. BUGFIX_PLAN v2): большие промпты с кодом не отваливаются
// с 413, при этом лимит конечный и защищает от OOM.
export const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;
