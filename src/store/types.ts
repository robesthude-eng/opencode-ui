import type { StateCreator } from "zustand";
import type { PromptModel } from "../api/client";
import type { ProcessedFile } from "../api/files";
import type {
  AppEvent,
  Message,
  PermissionRequest,
  SessionInfo,
  SessionStatus,
} from "../api/types";
import type { Theme } from "../config/theme";

export interface ModelEntry {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
  free: boolean;
}

export interface AuthSlice {
  authed: Record<string, boolean>;
  currentUser: { email: string; role?: "admin" | "user" } | null;
  authChecking: boolean;
  login: (
    email: string,
    pass: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  register: (
    email: string,
    pass: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkCurrentUser: () => Promise<void>;
  loadAuth: () => Promise<void>;
  saveKey: (providerId: string, key: string) => Promise<boolean>;
  removeKey: (providerId: string) => Promise<void>;
}

export interface ModelsSlice {
  models: ModelEntry[];
  modelsLoaded: boolean;
  selectedModel: PromptModel | null;
  loadModels: (force?: boolean) => Promise<void>;
  setSelectedModel: (m: PromptModel | null) => void;
}

export interface UiSlice {
  theme: Theme;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  workspaceOpen: boolean;
  selfImproveEnabled: boolean;
  selfImproveSessionId: string | null;
  selfImproveTestStatus: "idle" | "running" | "success" | "failure";
  selfImproveTestErrors: string[];
  toggleTheme: () => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setWorkspaceOpen: (open: boolean) => void;
  setSelfImproveSessionId: (id: string | null) => void;
  setSelfImproveEnabled: (enabled: boolean) => void;
  syncSelfImproveFromServer: () => Promise<void>;
}

export interface SessionsSlice {
  sessions: SessionInfo[];
  currentID: string | null;
  status: Record<string, SessionStatus>;
  permissions: PermissionRequest[];
  connection: "connecting" | "open" | "closed";
  serverConnected: boolean | null;
  loading: boolean;
  error: string | null;
  sessionError: boolean;
  loadSessions: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  newSession: () => Promise<void>;
  ensureSelfImproveSession: () => Promise<string | null>;
  removeSession: (id: string) => Promise<void>;
  abort: () => Promise<void>;
  respondPermission: (permissionId: string, allow: boolean) => Promise<void>;
  setConnection: (c: SessionsSlice["connection"]) => void;
  checkConnection: () => Promise<void>;
}

export interface MessagesSlice {
  messages: Record<string, Message[]>;
  attachments: ProcessedFile[];
  send: (text: string) => Promise<void>;
  addAttachments: (files: ProcessedFile[]) => void;
  removeAttachment: (name: string) => void;
  clearAttachments: () => void;
  applyEvent: (e: AppEvent) => void;
}

export interface State
  extends AuthSlice,
    ModelsSlice,
    UiSlice,
    SessionsSlice,
    MessagesSlice {}

export type Slice<T> = StateCreator<State, [], [], T>;

export const byUpdated = (a: SessionInfo, b: SessionInfo) =>
  (b.time?.updated ?? 0) - (a.time?.updated ?? 0);
