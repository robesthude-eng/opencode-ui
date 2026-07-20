/**
 * Предзагрузка Sentry: выполняется ДО загрузки остальных модулей сервера
 * (см. start.sh: `node --import ./server/instrument.mjs server/index.mjs`).
 * Так фатальные ошибки при старте сервера попадают в отчёты.
 * Повторный вызов в index.mjs безопасен: initSentryServer идемпотентен.
 */
import { initSentryServer } from "./sentry.mjs";

await initSentryServer();
