import { api } from "../../api/client";
import { ZEN_FREE_MODELS, ZEN_PROVIDER_ID } from "../../config/providers";

export const NOTION_MODELS = [
  { id: "fable-5", name: "Fable 5 (Notion)" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Notion)" },
  { id: "sonnet-5", name: "Sonnet 5 (Notion)" },
  { id: "opus-4.8", name: "Opus 4.8 (Notion)" },
  { id: "grok-4.5", name: "Grok 4.5 (Notion)" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro (Notion)" },
  { id: "gpt-5.4", name: "GPT-5.4 (Notion)" },
  { id: "gpt-5.2", name: "GPT-5.2 (Notion)" },
];
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

    // Add Notion AI bridge free models
    for (const m of NOTION_MODELS) {
      entries.push({
        providerID: "notion",
        providerName: "Notion AI (Bridge)",
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
        // Skip non-free and non-Notion providers (balance 0 — only free needed)
        if (p.id === "notion" && p.models) {
          for (const [modelID, m] of Object.entries(p.models)) {
            if (!entries.some((e) => e.modelID === modelID && e.providerID === "notion")) {
              entries.push({
                providerID: "notion",
                providerName: "Notion AI (Bridge)",
                modelID,
                modelName: (m.name ?? modelID) as string,
                free: true,
              });
            }
          }
          continue;
        }
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
