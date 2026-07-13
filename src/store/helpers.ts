import type { Message, Part, TextPart } from "../api/types";

export function cleanSysText(t: string): string {
  if (!t || typeof t !== "string") return t || "";
  return t
    .replace(/\n\n\[SYSTEM: Режим саморазвития[\s\S]*?\]/g, "")
    .replace(/\[SYSTEM: Режим саморазвития[\s\S]*?\]/g, "")
    .trim();
}

/** Type guard: is this Part a TextPart (has .text string)? */
function isTextPart(p: Part): p is TextPart {
  return p.type === "text" && typeof (p as TextPart).text === "string";
}

/** Type guard: does this Part have an `id` field? */
function hasId(p: Part): p is Part & { id: string } {
  return typeof (p as { id?: unknown }).id === "string";
}

// Normalize a message from the API: ensure `id` and `role` are at the top level.
// In opencode 1.17.x, `id` is inside `info.id` and `role` is inside `info.role`.
export function normalizeMessage(msg: Message): Message {
  const info = msg.info;
  const id = msg.id || info?.id || "";
  const role: Message["role"] =
    msg.role || (info?.role as Message["role"] | undefined) || "assistant";
  const parts = (msg.parts || []).map((p) => {
    if (role === "user" && isTextPart(p)) {
      return { ...p, text: cleanSysText(p.text) };
    }
    return p;
  });
  return { ...msg, id, role, parts };
}

export function normalizeMessages(msgs: Message[]): Message[] {
  return msgs.map(normalizeMessage);
}

export function upsertMessage(messages: Message[], msg: Message): Message[] {
  const idx = messages.findIndex((m) => m.id === msg.id);
  if (idx === -1) {
    if (msg.role === "user" && !msg.id.startsWith("local_")) {
      const localIdx = messages.findIndex((m) => m.id.startsWith("local_") && m.role === "user");
      if (localIdx !== -1) {
        const copy = messages.slice();
        const existingLocal = copy[localIdx];
        if (existingLocal) {
          const parts = msg.parts && msg.parts.length > 0 ? msg.parts : existingLocal.parts;
          copy[localIdx] = { ...msg, parts };
          return copy;
        }
      }
    }
    return [...messages, { ...msg, parts: msg.parts ?? [] }];
  }
  const copy = messages.slice();
  // Preserve existing parts: an info-only update (e.g. final tokens at end of
  // turn) must NOT blank out the accumulated text/tool parts.
  const existing = copy[idx];
  if (!existing) return [...messages, { ...msg, parts: msg.parts ?? [] }];
  const incoming = msg as Message;
  const parts = incoming.parts && incoming.parts.length > 0 ? incoming.parts : existing.parts;
  const { parts: _omit, ...rest } = msg;
  copy[idx] = { ...existing, ...rest, parts } as Message;
  if (msg.role === "user" && !msg.id.startsWith("local_")) {
    return copy.filter((m) => m.id === msg.id || !m.id.startsWith("local_"));
  }
  return copy;
}

export function patchPart(messages: Message[], messageID: string, part: Part): Message[] {
  const targetID = messageID;
  const exists = messages.some((m) => m.id === targetID);
  if (!exists) {
    const localIdx = messages.findIndex(
      (m) => m.id.startsWith("local_") && m.role === "user" && part.type === "text",
    );
    if (localIdx !== -1) {
      const copy = messages.slice();
      const cleanedPart = isTextPart(part) ? { ...part, text: cleanSysText(part.text) } : part;
      copy[localIdx] = { ...copy[localIdx], id: targetID, parts: [cleanedPart] };
      return copy;
    }
    return [...messages, { id: targetID, role: "assistant", parts: [part] }];
  }
  return messages.map((m) => {
    if (m.id !== targetID) return m;
    const cleanedPart =
      m.role === "user" && isTextPart(part) ? { ...part, text: cleanSysText(part.text) } : part;
    const pid = hasId(cleanedPart) ? cleanedPart.id : undefined;
    let idx = pid ? m.parts.findIndex((p) => hasId(p) && p.id === pid) : -1;
    if (idx === -1) {
      idx = m.parts.findIndex(
        (p) =>
          !hasId(p) &&
          p.type === cleanedPart.type &&
          (m.role === "user" ||
            (isTextPart(p) && isTextPart(cleanedPart) && p.text === cleanedPart.text)),
      );
      if (
        idx === -1 &&
        m.parts.length === 1 &&
        m.parts[0] !== undefined &&
        m.parts[0].type === cleanedPart.type &&
        !hasId(m.parts[0])
      ) {
        idx = 0;
      }
    }
    if (idx === -1 || idx >= m.parts.length) return { ...m, parts: [...m.parts, cleanedPart] };
    const parts = m.parts.slice();
    const target = parts[idx];
    if (target === undefined) return { ...m, parts: [...m.parts, cleanedPart] };
    parts[idx] = { ...target, ...cleanedPart };
    return { ...m, parts };
  });
}

export function patchPartDelta(
  messages: Message[],
  messageID: string,
  partID: string,
  field: string,
  delta: unknown,
): Message[] {
  if (!messageID || !partID || !field || delta === undefined) return messages;
  const exists = messages.some((m) => m.id === messageID);
  if (!exists) {
    const stubPart: Record<string, unknown> = { id: partID, type: "text" };
    stubPart[field] = typeof delta === "string" ? delta : delta;
    return [...messages, { id: messageID, role: "assistant", parts: [stubPart as Part] }];
  }
  return messages.map((m) => {
    if (m.id !== messageID) return m;
    const idx = m.parts.findIndex((p) => (p as { id?: string }).id === partID);
    if (idx === -1) {
      const newPart: Record<string, unknown> = { id: partID, type: "text" };
      newPart[field] = typeof delta === "string" ? delta : delta;
      return { ...m, parts: [...m.parts, newPart as Part] };
    }
    const parts = m.parts.slice();
    const existingPart = parts[idx];
    if (existingPart === undefined) {
      const newPart: Record<string, unknown> = { id: partID, type: "text" };
      newPart[field] = typeof delta === "string" ? delta : delta;
      return { ...m, parts: [...m.parts, newPart as Part] };
    }
    const target = { ...existingPart } as Record<string, unknown>;
    const cur = target[field];
    if (typeof cur === "string" || typeof delta === "string") {
      target[field] = (typeof cur === "string" ? cur : "") + String(delta);
    } else {
      target[field] = delta;
    }
    parts[idx] = target as Part;
    return { ...m, parts };
  });
}
