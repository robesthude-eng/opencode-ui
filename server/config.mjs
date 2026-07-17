import path from "node:path";

export const SYSTEM_PORT = parseInt(process.env.OC_SYSTEM_PORT || "4096", 10);
export const PORT = 3000;
export const WORKDIR = process.env.OPENCODE_WORKDIR || "/app/workspace";
export const USERS_FILE = path.join(WORKDIR, ".users.json");
export const SESSIONS_FILE = path.join(WORKDIR, ".sessions.json");
export const OWNERS_FILE = path.join(WORKDIR, ".session_owners.json");
export const USER_KEYS_DIR = path.join(WORKDIR, ".user_keys");
export const MAX_JSON_BODY_BYTES = 256 * 1024;
