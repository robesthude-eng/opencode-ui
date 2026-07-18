/**
 * Structured logging via pino.
 * JSON in production, pretty in development when pino-pretty is available.
 */
import pino from "pino";

// Релиз 3: прод — это всё, что НЕ явное NODE_ENV=development. Раньше сервер
// вне Railway (например, Timeweb) без выставленного NODE_ENV считался dev
// и тратил 15-20% CPU на раскрашенный pino-pretty.
const isProd = process.env.NODE_ENV !== "development";

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
