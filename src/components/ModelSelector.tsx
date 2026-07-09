import { useEffect, useRef, useState } from "react";
import { useStore, type ModelEntry } from "../store/useStore";
import { ChevronDownIcon, CheckIcon } from "./icons";

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
    (m) =>
      m.providerID === selectedModel?.providerID &&
      m.modelID === selectedModel?.modelID
  );

  // Group: free models first, then by provider.
  const free = models.filter((m) => m.free);
  const paid = models.filter((m) => !m.free);

  const paidGrouped: Record<string, ModelEntry[]> = {};
  for (const m of paid) {
    (paidGrouped[m.providerName] ??= []).push(m);
  }

  const renderOption = (m: ModelEntry) => {
    const active =
      m.providerID === selectedModel?.providerID &&
      m.modelID === selectedModel?.modelID;
    return (
      <button
        key={`${m.providerID}/${m.modelID}`}
        className={`model-option ${active ? "active" : ""}`}
        onClick={() => {
          setSelectedModel({ providerID: m.providerID, modelID: m.modelID });
          setOpen(false);
        }}
      >
        <span className="model-option-label">
          {m.modelName}
          {m.free && <span className="model-free-pill">FREE</span>}
        </span>
        {active && <CheckIcon size={14} />}
      </button>
    );
  };

  return (
    <div className="model-select" ref={ref}>
      <button className="model-select-btn" onClick={() => setOpen((o) => !o)}>
        <span className="model-select-name">
          {current?.modelName ?? "Select model"}
          {current?.free && <span className="model-free-pill">FREE</span>}
        </span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <div className="model-select-menu">
          {free.length > 0 && (
            <div className="model-group">
              <div className="model-group-title">🎁 Free · OpenCode Zen</div>
              {free.map(renderOption)}
            </div>
          )}
          {Object.entries(paidGrouped).map(([providerName, list]) => (
            <div className="model-group" key={providerName}>
              <div className="model-group-title">{providerName}</div>
              {list.map(renderOption)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
