import { create } from "zustand";
import type { State, ModelEntry } from "./types";
import { createAuthSlice } from "./slices/authSlice";
import { createModelsSlice } from "./slices/modelsSlice";
import { createUiSlice } from "./slices/uiSlice";
import { createSessionsSlice } from "./slices/sessionsSlice";
import { createMessagesSlice } from "./slices/messagesSlice";

export type { State, ModelEntry };

export const useStore = create<State>((...a) => ({
  ...createAuthSlice(...a),
  ...createModelsSlice(...a),
  ...createUiSlice(...a),
  ...createSessionsSlice(...a),
  ...createMessagesSlice(...a),
}));
