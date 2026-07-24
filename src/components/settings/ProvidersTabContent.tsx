import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PROVIDERS } from "../../config/providers";
import { useStore } from "../../store/useStore";
import { CheckIcon } from "../icons";
import { useApiKeyForm } from "./useApiKeyForm";

/**
 * "Bring your own API key" (BYOK) providers tab. Fully self-contained — owns
 * its own key-entry form state and per-provider "editing" toggle state.
 */
export function ProvidersTabContent() {
  const authed = useStore((s) => s.authed);
  const removeKey = useStore((s) => s.removeKey);
  const { values, saving, setValue, handleSave } = useApiKeyForm();
  const [editingProviders, setEditingProviders] = useState<
    Record<string, boolean>
  >({});
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Свой API-ключ (BYOK)</h3>
        <p className="text-xs text-muted-foreground">
          Платные провайдеры без хранения ваших данных (zero retention).
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {PROVIDERS.map((p) => {
          const configured = !!authed[p.id];
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-xl border p-3 bg-card",
                configured && "border-emerald-500/30",
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                  style={{ background: p.color }}
                >
                  {p.name.charAt(0)}
                </div>
                <div>
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {p.name} {configured && <CheckIcon size={14} />}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.models}
                  </div>
                </div>
              </div>
              {configured && !editingProviders[p.id] ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 flex items-center gap-1">
                    🔑 API-ключ подключён
                  </span>
                  <div className="flex gap-3">
                    <button
                      className="text-primary hover:underline"
                      onClick={() => {
                        setEditingProviders((prev) => ({
                          ...prev,
                          [p.id]: true,
                        }));
                        setValue(p.id, "");
                      }}
                      type="button"
                    >
                      Изменить
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => removeKey(p.id)}
                      type="button"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    type="password"
                    placeholder={p.keyHint}
                    value={values[p.id] ?? ""}
                    onChange={(e) => setValue(p.id, e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      handleSave(p.id)
                        .then((ok) => {
                          if (ok && mountedRef.current)
                            setEditingProviders((prev) => ({
                              ...prev,
                              [p.id]: false,
                            }));
                        })
                        .catch(() => {})
                    }
                    className="flex-1 min-w-[180px] h-8"
                    autoFocus={editingProviders[p.id]}
                  />
                  <Button
                    size="sm"
                    disabled={!values[p.id]?.trim() || saving === p.id}
                    onClick={() => {
                      handleSave(p.id)
                        .then((ok) => {
                          if (ok && mountedRef.current)
                            setEditingProviders((prev) => ({
                              ...prev,
                              [p.id]: false,
                            }));
                        })
                        .catch(() => {});
                    }}
                  >
                    {saving === p.id
                      ? "…"
                      : editingProviders[p.id]
                        ? "Сохранить"
                        : "Подключить"}
                  </Button>
                  {editingProviders[p.id] && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditingProviders((prev) => ({
                          ...prev,
                          [p.id]: false,
                        }));
                        setValue(p.id, "");
                      }}
                      type="button"
                    >
                      Отмена
                    </button>
                  )}
                </div>
              )}
              <a
                className="text-xs text-primary hover:underline mt-2 inline-block"
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Получить ключ →
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
