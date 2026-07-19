/**
 * P1.2 — Auth routes extracted from server/index.mjs
 * Preserves gate order exactly, no body rewrites.
 * Pure handlers that receive context.
 */
import crypto from "node:crypto";
import {
  buildCsrfCookie,
  buildSessionCookie,
  checkAuthRateLimit,
  hashPassword,
  isAdmin,
  resetAuthRateLimit,
  verifyPassword,
} from "../auth.mjs";
import { loadJson, saveAuthJson } from "../db.mjs";
import { logger } from "../logger.mjs";
import { readBody } from "../middleware.mjs";

export async function handleRegister(
  req,
  res,
  { USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS },
) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }
  if (!(await checkAuthRateLimit(req, res))) return;
  try {
    const buf = await readBody(req, 16384);
    const body = JSON.parse(buf.toString("utf8") || "{}");
    const { email, password, inviteCode } = body;
    if (!email?.includes("@") || !password || password.length < 6) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Enter a valid email and password (min 6 characters).",
        }),
      );
      return;
    }

    // 1. Invite code verification (if configured in environment)
    const configuredInviteCode = process.env.OPENCODE_INVITE_CODE;
    if (configuredInviteCode && configuredInviteCode.trim().length > 0) {
      if (inviteCode !== configuredInviteCode) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid invite code." }));
        return;
      }
    }

    const cleanEmail = email.toLowerCase().trim();

    // 2. Admin emails allowlist verification (if configured in environment)
    const adminEmailsRaw = process.env.OPENCODE_ADMIN_EMAILS || "";
    const adminEmails = new Set(
      adminEmailsRaw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
    if (adminEmails.size > 0 && !adminEmails.has(cleanEmail)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Your email is not on the admin allowlist." }),
      );
      return;
    }

    const users = loadJson(USERS_FILE, {});
    if (users[cleanEmail]) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "User with this email already exists." }),
      );
      return;
    }
    const role = Object.keys(users).length === 0 ? "admin" : "user";
    users[cleanEmail] = {
      email: cleanEmail,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      role,
    };
    saveAuthJson(USERS_FILE, users);
    const token = crypto.randomBytes(32).toString("hex");
    const sessions = loadJson(SESSIONS_FILE, {});
    sessions[token] = { email: cleanEmail, createdAt: Date.now() };
    saveAuthJson(SESSIONS_FILE, sessions);
    await resetAuthRateLimit(req);
    logger.info({ email: cleanEmail, role }, "user registered");
    res.writeHead(200, {
      "Content-Type": "application/json",
      // Сессионная кука + CSRF-кука (Double Submit): фронтенд читает вторую
      // и шлёт её значение в заголовке x-csrf-token.
      "Set-Cookie": [
        buildSessionCookie(token, SESSION_TTL_MS, req),
        buildCsrfCookie(SESSION_TTL_MS, req),
      ],
    });
    res.end(
      JSON.stringify({
        status: "success",
        token,
        user: { email: cleanEmail, role },
      }),
    );
  } catch (_e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Registration failed" }));
  }
}

export async function handleLogin(
  req,
  res,
  { USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS },
) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }
  if (!(await checkAuthRateLimit(req, res))) return;
  try {
    const buf = await readBody(req, 16384);
    const { email, password } = JSON.parse(buf.toString("utf8") || "{}");
    const users = loadJson(USERS_FILE, {});
    const cleanEmail = (email || "").toLowerCase().trim();
    const user = users[cleanEmail];
    if (!user || !verifyPassword(password || "", user.passwordHash)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid email or password." }));
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    const sessions = loadJson(SESSIONS_FILE, {});
    sessions[token] = { email: cleanEmail, createdAt: Date.now() };
    saveAuthJson(SESSIONS_FILE, sessions);
    await resetAuthRateLimit(req);
    logger.info({ email: cleanEmail }, "user logged in");
    res.writeHead(200, {
      "Content-Type": "application/json",
      // Сессионная кука + CSRF-кука (Double Submit): фронтенд читает вторую
      // и шлёт её значение в заголовке x-csrf-token.
      "Set-Cookie": [
        buildSessionCookie(token, SESSION_TTL_MS, req),
        buildCsrfCookie(SESSION_TTL_MS, req),
      ],
    });
    res.end(
      JSON.stringify({
        status: "success",
        token,
        user: {
          email: cleanEmail,
          role: isAdmin(cleanEmail, USERS_FILE) ? "admin" : user.role || "user",
        },
      }),
    );
  } catch (_e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Login failed" }));
  }
}

export function handleMe(
  req,
  res,
  { USERS_FILE, SESSIONS_FILE, SESSION_TTL_MS, getUserEmail },
) {
  const email = getUserEmail(req, SESSIONS_FILE, SESSION_TTL_MS);
  if (!email) {
    const users = loadJson(USERS_FILE, {});
    if (Object.keys(users).length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "success", user: null, noUsers: true }));
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "success",
      user: { email, role: isAdmin(email, USERS_FILE) ? "admin" : "user" },
    }),
  );
}

export function handleLogout(
  req,
  res,
  {
    SESSIONS_FILE,
    extractToken,
    saveAuthJson,
    buildClearSessionCookie,
    loadJson,
  },
) {
  // Note: saveAuthJson and loadJson passed for testability, but we use db.mjs directly inside if not provided
  const token = extractToken(req);
  const sessions = loadJson(SESSIONS_FILE, {});
  if (token) delete sessions[token];
  saveAuthJson(SESSIONS_FILE, sessions);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": buildClearSessionCookie(),
  });
  res.end(JSON.stringify({ status: "success" }));
}
