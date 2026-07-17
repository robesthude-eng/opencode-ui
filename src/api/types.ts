// Types modelled on the OpenCode HTTP API (generated OpenAPI / SDK).
// Field names follow the documented Session.Info / MessageV2 / Part shapes.
// If your opencode version differs, cross-check against GET /doc.

export interface SessionInfo {
  id: string;
  title: string;
  parentID?: string;
  share?: { url?: string } | null;
  time?: { created: number; updated: number };
  version?: string;

}

export type SessionStatus = "idle" | "busy" | "retry" | "error" | string;

/** Status can be a plain string or an object with .type — normalize at use site. */
export interface SessionStatusObject {
  type: SessionStatus;

}

export interface BasePart {
  id?: string;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
}

export interface AttachmentPart extends BasePart {
  type: "attachment";
  name: string;
  size: number;
  kind: "image" | "zip" | "pdf" | "text" | string;
  path?: string;
  dataUrl?: string;
  textPart?: Record<string, unknown>;
  part?: Record<string, unknown>;
  uploadedPath?: string;
  entryCount?: number;
}

export interface ToolOutput {
  type: "text" | "json" | "error";
  text?: string;
  json?: unknown;
  error?: { message?: string; name?: string };
}

export interface ToolPart extends BasePart {
  type: "tool";
  tool: string;
  callID?: string;
  // In opencode 1.17.x, `state` is an OBJECT, not a string.
  state?: ToolState | string;
  input?: unknown; // legacy: some versions put input here
  output?: ToolOutput; // legacy
}

export interface ToolState {
  status?: string; // "running" | "completed" | "error"
  input?: unknown;
  output?: string | ToolOutput;
  title?: string;

  metadata?: { exit?: number; truncated?: boolean; };
  time?: { start?: number; end?: number };
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | AttachmentPart
  | (BasePart & Record<string, unknown>);

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Part[];
  sessionID?: string;
    session_id?: string;
    sessionId?: string;
  time?: { created: number; completed?: number };
  info?: {
    id?: string;
    role?: string;
    model?: string;
    finish?: "stop" | "error" | "length" | "tool_call" | string;
    tokens?: { input?: number; output?: number };
    time?: { created?: number; completed?: number };
    error?: { message?: string; name?: string; data?: { message?: string } };
    structured_output?: unknown;
  };
  // Allow legacy/extra fields without forcing `any` casts in consumer code.

}

// SSE event envelope. OpenCode emits `{ type, properties }`.
export interface AppEvent {
  type: string;
  properties: {
    sessionID?: string;
    session_id?: string;
    sessionId?: string;
    messageID?: string;
    message_id?: string;
    messageId?: string;
    partID?: string;
    part_id?: string;
    partId?: string;
    message?: Message;
    info?: Record<string, unknown>;
    part?: Part;
    session?: SessionInfo;
    status?: SessionStatus;
    id?: string; // permission id
    delta?: string;
    field?: string;
    tool?: string;
    input?: unknown;

  };
}

export interface PermissionRequest {
  sessionID: string;
  id: string; // permission id
  tool?: string;
  input?: unknown;
}

// --- File system / workspace ---

export interface FileNode {
  path: string; // relative path within the project
  name?: string;
  type?: "file" | "directory";
  isDirectory?: boolean;
  size?: number;
}

export type GitStatus = "modified" | "added" | "deleted" | "untracked" | "renamed";

export interface TrackedFile {
  path: string;
  status?: GitStatus;

}

// --- Providers / models ---

export interface ProviderModel {
  id?: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  cost?: { input?: number; output?: number };
  limit?: { context?: number; output?: number };

}

export interface Provider {
  id: string;
  name?: string;
  models?: Record<string, ProviderModel>;

}

export interface ProvidersResponse {
  providers: Provider[];
  default?: Record<string, string>;
}
