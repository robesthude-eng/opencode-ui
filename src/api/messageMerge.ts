/**
 * Deterministic source-aware message reconciliation helpers.
 * The live SSE transport is implemented by EventStream in events.ts.
 */

/**
 * Pure deterministic merge: source-aware, never shortens streaming text unless server says final.
 *
 * Rules:
 * 1. Server message list is authoritative for IDs that exist on server.
 * 2. Local optimistic messages (id startsWith local_) are preserved until server confirms with same role/text? Actually replaced by server when server message with same local correlation arrives.
 * 3. For assistant messages, if local streaming part text is longer than server text AND server part is not final (no time.completed and finish !== stop|error), keep local longer text.
 * 4. For user messages, preserve local attachment parts that server hasn't echoed yet.
 * 5. Never use JSON.stringify length — use actual text length and part-level comparison.
 */
import type { Message as MergeMessage } from "./types";

// export interface MergeMessage {
//   id: string;
//   role: "user" | "assistant" | "system";
//   parts: { id?: string; type: string; text?: string; [k: string]: unknown }[];
//   info?: { finish?: string; time?: { completed?: number } };
// }

// Tool part lifecycle rank — higher means further along. Used to avoid
// downgrading a tool card that SSE already marked completed back to a
// stale "running"/"pending" state from an HTTP snapshot.
const TOOL_STATUS_RANK: Record<string, number> = {
  pending: 0,
  running: 1,
  completed: 2,
  error: 2,
};

function toolStatus(p: unknown): string | undefined {
  const state = (p as { state?: { status?: string } | string }).state;
  if (typeof state === "string") return state;
  return state?.status;
}

export function mergeMessages(
  serverMsgs: MergeMessage[],
  localMsgs: MergeMessage[],
): MergeMessage[] {
  const merged: MergeMessage[] = [];
  const localById = new Map(localMsgs.map((m) => [m.id, m]));

  for (const sMsg of serverMsgs) {
    const lMsg = localById.get(sMsg.id);
    if (!lMsg) {
      // No local counterpart — take server as-is, but preserve any local attachments if user message
      if (sMsg.role === "user") {
        const localOptimistic = localMsgs.find(
          (m) => m.id.startsWith("local_") && m.role === "user",
        );
        if (localOptimistic) {
          const localAtts = localOptimistic.parts.filter(
            (p) => p.type === "attachment",
          );
          if (localAtts.length > 0) {
            const hasAtts = sMsg.parts.some((p) => p.type === "attachment");
            if (!hasAtts) {
              merged.push({ ...sMsg, parts: [...localAtts, ...sMsg.parts] });
              localById.delete(localOptimistic.id);
              continue;
            }
          }
        }
      }
      merged.push(sMsg);
      continue;
    }

    // Both exist — deterministic merge
    if (sMsg.role === "user") {
      // Preserve local attachments that server hasn't echoed
      const localAtts = lMsg.parts.filter((p) => p.type === "attachment");
      const serverHasAtts = sMsg.parts.some((p) => p.type === "attachment");
      const mergedParts = serverHasAtts
        ? sMsg.parts
        : [...localAtts, ...sMsg.parts.filter((p) => p.type !== "attachment")];
      merged.push({ ...sMsg, parts: mergedParts });
      localById.delete(lMsg.id);
      continue;
    }

    // Assistant message — check for streaming text preservation
    const isFinal = !!(
      sMsg.info?.finish === "stop" ||
      sMsg.info?.finish === "error" ||
      sMsg.info?.time?.completed
    );
    const mergedParts = sMsg.parts.map((sPart) => {
      const lPart = lMsg.parts.find((p) => p.id === sPart.id);
      if (!lPart) return sPart;
      // Streaming text preservation applies to text AND reasoning parts:
      // the HTTP poller snapshot may lag behind SSE deltas, so never roll
      // streamed text back while the message is not final.
      if (
        (sPart.type === "text" || sPart.type === "reasoning") &&
        lPart.type === sPart.type
      ) {
        const sText = (sPart as any).text || "";
        const lText = (lPart as any).text || "";
        // If server is NOT final and local text is longer and is prefix-extended from server, keep local
        // Example: server "first", local "first second" — keep local because server hasn't finished streaming
        // But if server text is different (not prefix), take server (authoritative)
        if (
          !isFinal &&
          lText.length > sText.length &&
          lText.startsWith(sText)
        ) {
          return { ...sPart, text: lText };
        }
        // Deterministic: server wins when final, local wins when non-final and longer
        return sPart;
      }
      // Tool parts: never downgrade a local state that is further along
      // (completed/error via SSE) to an older server snapshot (pending/running).
      if (sPart.type === "tool" && lPart.type === "tool" && !isFinal) {
        const sRank = TOOL_STATUS_RANK[toolStatus(sPart) ?? ""] ?? -1;
        const lRank = TOOL_STATUS_RANK[toolStatus(lPart) ?? ""] ?? -1;
        if (lRank > sRank) return lPart;
      }
      return sPart;
    });

    // Also preserve any local parts that server hasn't yet sent (e.g., part_late that arrived out-of-order via delta)
    for (const lPart of lMsg.parts) {
      if (!mergedParts.find((p) => p.id === lPart.id)) {
        mergedParts.push(lPart);
      }
    }

    merged.push({ ...sMsg, parts: mergedParts });
    localById.delete(lMsg.id);
  }

  // Add remaining local messages that server doesn't know (optimistic, not local_? Already handled local_ skip)
  // Keep non-local_ local messages that are not yet on server (e.g., pending user message)
  for (const [id, lMsg] of localById) {
    if (id.startsWith("local_")) continue; // optimistic already handled or replaced
    if (!merged.find((m) => m.id === id)) {
      merged.push(lMsg);
    }
  }

  // Preserve original server order, but ensure optimistic local_ messages that weren't replaced stay at end
  // Actually we already filtered local_ during loop; re-add any remaining local_ if they weren't replaced
  for (const lMsg of localMsgs) {
    if (lMsg.id.startsWith("local_") && !merged.find((m) => m.id === lMsg.id)) {
      // If server has a user message that corresponds to this local_ (by text similarity), don't duplicate
      // Simple heuristic: if last user message in merged is same text as local_, skip
      const lastUser = [...merged].reverse().find((m) => m.role === "user");
      const localText = lMsg.parts.find((p) => p.type === "text") as any;
      const serverText = lastUser?.parts.find((p) => p.type === "text") as any;
      if (
        localText?.text &&
        serverText?.text &&
        localText.text === serverText.text
      ) {
        continue;
      }
      merged.push(lMsg);
    }
  }

  return merged;
}

/**
 * Deterministic scenario harness for tests (fake timers compatible)
 * Allows simulating event sequences and asserting final merged state.
 */
export function createScenarioHarness(
  initialLocal: MergeMessage[] = [],
  initialServer: MergeMessage[] = [],
) {
  let local = [...initialLocal];
  let server = [...initialServer];

  return {
    setLocal(msgs: MergeMessage[]) {
      local = [...msgs];
    },
    setServer(msgs: MergeMessage[]) {
      server = [...msgs];
    },
    applyServerUpdate(newServer: MergeMessage[]) {
      server = [...newServer];
      return mergeMessages(server, local);
    },
    applyLocalDelta(
      _sessionId: string,
      messageId: string,
      partId: string,
      delta: string,
    ) {
      // Simulate message.part.delta applied to local
      local = local.map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          parts: m.parts.map((p) => {
            if (p.id !== partId) return p;
            return { ...p, text: (p.type === "text" ? p.text : "") + delta };
          }),
        };
      });
      return [...local];
    },
    getMerged() {
      return mergeMessages(server, local);
    },
    getLocal() {
      return [...local];
    },
    getServer() {
      return [...server];
    },
  };
}
