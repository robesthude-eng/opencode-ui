/**
 * Structured logging via pino.
 * JSON in production, pretty in development when pino-pretty is available.
 */
import pino from "pino";

const isProd =
  process.env.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT != null;

const options = {
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  base: { service: "opencode-ui" },
  timestamp: pino.stdTimeFunctions.isoTime,
};

let transport;
if (!isProd) {
  try {
    transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    };
  } catch {
    transport = undefined;
  }
}

export const logger = pino(transport ? { ...options, transport } : options);

export function child(bindings) {
  return logger.child(bindings);
}

export default logger;
