import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { type ModelEntry, useStore } from "../store/useStore";
import { CheckIcon, ChevronDownIcon } from "./icons";

export default function ModelSelector() {
  const models = useStore((s) => s.models);
  const selectedModel = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (models.length === 0) return null;

  const current = models.find(
    (m) => m.providerID === selectedModel?.providerID && m.modelID === selectedModel?.modelID,
  );

  const free = models.filter((m) => m.free);
  const paid = models.filter((m) => !m.free);

  const paidGrouped: Record<string, ModelEntry[]> = {};
  for (const m of paid) {
    (paidGrouped[m.providerName] ??= []).push(m);
  }

  const renderOption = (m: ModelEntry) => {
    const active =
      m.providerID === selectedModel?.providerID && m.modelID === selectedModel?.modelID;
    return (
      <button
        key={`${m.providerID}/${m.modelID}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition",
          active
            ? "bg-muted text-foreground"
            : "hover:bg-muted/70 text-muted-foreground hover:text-foreground",
        )}
        onClick={() => {
          setSelectedModel({ providerID: m.providerID, modelID: m.modelID });
          setOpen(false);
        }}
      >
        <span className="flex items-center gap-2">
          {m.modelName}
          {m.free && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">
              FREE
            </span>
          )}
        </span>
        {active && <CheckIcon size={14} />}
      </button>
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 md:px-3 py-1.5 text-xs md:text-sm hover:bg-muted transition shadow-sm max-w-full"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">{current?.modelName ?? "Select model"}</span>
          {current?.free && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold shrink-0">
              FREE
            </span>
          )}
        </span>
        <span className="shrink-0">
          <ChevronDownIcon size={14} />
        </span>
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-[300px] sm:w-[320px] max-w-[calc(100vw-1rem)] max-h-[60dvh] overflow-y-auto rounded-2xl border border-border bg-popover shadow-xl p-2 z-50">
          {free.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                🎁 Free · OpenCode Zen
              </div>
              <div className="space-y-0.5">{free.map(renderOption)}</div>
            </div>
          )}
          {Object.entries(paidGrouped).map(([providerName, list]) => (
            <div key={providerName} className="mb-2">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                {providerName}
              </div>
              <div className="space-y-0.5">{list.map(renderOption)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
