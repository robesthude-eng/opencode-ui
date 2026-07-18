// Релиз 5: рукописные type guards для SSE-пейлоадов — без zod и новых
// зависимостей. Заменяют небезопасные `as unknown as` касты: каждое
// обращение к динамическому полю проходит через рантайм-проверку.
import type { AppEvent } from "./types";

/** Значение — объект (record)? */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Строковое поле динамического объекта (part.sessionID, message.id …).
 * undefined — если объект не объект или поле не строка.
 */
export function strField(v: unknown, key: string): string | undefined {
  if (!isRecord(v)) return undefined;
  const value = v[key];
  return typeof value === "string" ? value : undefined;
}

/** Кадр из стрима структурно похож на AppEvent ({ type, properties })? */
export function isAppEventShaped(v: unknown): v is AppEvent {
  return isRecord(v) && typeof v.type === "string" && isRecord(v.properties);
}

/**
 * Статус сессии приходит строкой ("busy") или объектом ({ type: "busy" })
 * в новых версиях opencode — нормализуем к строке.
 */
export function statusText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return strField(raw, "type") || "idle";
}
