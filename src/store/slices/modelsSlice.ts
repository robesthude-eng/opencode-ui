import { api } from "../../api/client";
import {
  GOOGLE_FALLBACK_MODELS,
  ZEN_FREE_MODELS,
  ZEN_PROVIDER_ID,
} from "../../config/providers";
import type { ModelEntry, ModelsSlice, Slice } from "../types";

export const createModelsSlice: Slice<ModelsSlice> = (set, get) => ({
  models: [],
  modelsLoaded: false,
  selectedModel: { providerID: "opencode", modelID: "deepseek-v4-flash-free" },

  loadModels: async (force?: boolean) => {
    if (get().modelsLoaded && !force) return;
    const authed = get().authed;
    if (Object.keys(authed).length === 0) {
      await get().loadAuth();
    }
    const auth = get().authed;
    const entries: ModelEntry[] = [];

    // Always include OpenCode Zen free models
    for (const m of ZEN_FREE_MODELS) {
      entries.push({
        providerID: ZEN_PROVIDER_ID,
        providerName: "OpenCode Zen",
        modelID: m.id,
        modelName: m.name,
        free: true,
      });
    }

    let def: Record<string, string> = {};
    try {
      const res = await api.listProviders();
      def = res.default ?? {};
      for (const p of res.providers ?? []) {
        if (p.id === ZEN_PROVIDER_ID) {
          if (p.models) {
            for (const [modelID, m] of Object.entries(p.models)) {
              if (!entries.some((e) => e.modelID === modelID)) {
                const costObj = (
                  m as { cost?: { input?: number; output?: number } }
                ).cost;
                const isFree =
                  !costObj ||
                  (costObj.input === 0 && costObj.output === 0) ||
                  modelID.endsWith("-free") ||
                  modelID === "big-pickle";
                if (isFree) {
                  entries.push({
                    providerID: ZEN_PROVIDER_ID,
                    providerName: "OpenCode Zen",
                    modelID,
                    modelName: (m as { name?: string }).name || modelID,
                    free: true,
                  });
                }
              }
            }
          }
          continue;
        }
        if (!auth[p.id]) continue;
        if (!p.models) continue;
        for (const [modelID, m] of Object.entries(p.models)) {
          entries.push({
            providerID: p.id,
            providerName: (p.name ?? p.id) as string,
            modelID,
            modelName: (m.name ?? modelID) as string,
            free: false,
          });
        }
      }
      // Fallback: if the user saved a Google API key in the UI DB but OpenCode
      // doesn't return a "google" provider in /config/providers (known issue
      // with OpenCode 1.18.x — accepts PUT /auth/google but doesn't list it),
      // inject the standard Gemini model set so they appear in the selector.
      if (auth["google"] && !res.providers?.some((p) => p.id === "google")) {
        for (const m of GOOGLE_FALLBACK_MODELS) {
          entries.push({
            providerID: "google",
            providerName: "Google",
            modelID: m.id,
            modelName: m.name,
            free: false,
          });
        }
      }
    } catch {
      // non-fatal: fall back to free models only
    }

    let selected = get().selectedModel;
    if (!selected && entries.length > 0) {
      const deepseekV4 = entries.find(
        (e) =>
          e.modelID.includes("deepseek-v4") ||
          e.modelName.toLowerCase().includes("deepseek"),
      );
      const defaultEntry = entries.find((e) => def[e.providerID] === e.modelID);
      const first = deepseekV4 ?? defaultEntry ?? entries[0];
      if (first) {
        selected = { providerID: first.providerID, modelID: first.modelID };
      }
    }
    set({ models: entries, modelsLoaded: true, selectedModel: selected });
  },

  setSelectedModel: (selectedModel) => set({ selectedModel }),
});
