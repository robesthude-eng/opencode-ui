// Релиз 5: вынесено из server/index.mjs без изменений логики.
// Релиз 4: кольцевой буфер SSE-кадров с поддержкой Last-Event-ID.
// Прокси присваивает каждому кадру монотонный `id: N` (счётчик живёт
// в буфере и переживает реконнекты upstream) и хранит последние
// SSE_RING_SIZE кадров на ключ (сессию). Клиент, переподключившись
// с Last-Event-ID (заголовок или ?lastEventId=), получает пропущенные
// за время разрыва кадры из буфера — кусочки ответа не теряются.
export const SSE_RING_SIZE =
  parseInt(process.env.SSE_RING_SIZE || "", 10) || 500;
const SSE_RING_MAX_KEYS = 100;
const SSE_RING_TTL_MS = 30 * 60 * 1000;
export const sseRings = new Map(); // key -> { nextSeq, frames: [{seq, payload}], lastUsed }
export function sseRingFor(key) {
  const now = Date.now();
  let ring = sseRings.get(key);
  if (!ring) {
    // Лёгкая уборка: сначала протухшие ключи, затем самые старые.
    if (sseRings.size >= SSE_RING_MAX_KEYS) {
      for (const [k, r] of sseRings) {
        if (now - r.lastUsed > SSE_RING_TTL_MS) sseRings.delete(k);
      }
      while (sseRings.size >= SSE_RING_MAX_KEYS) {
        sseRings.delete(sseRings.keys().next().value);
      }
    }
    ring = { nextSeq: 1, frames: [], lastUsed: now };
    sseRings.set(key, ring);
  }
  ring.lastUsed = now;
  return ring;
}
