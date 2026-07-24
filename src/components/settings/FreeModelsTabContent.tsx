import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ZEN_FREE_MODELS, ZEN_PROVIDER_ID } from "../../config/providers";
import { useStore } from "../../store/useStore";
import { CheckIcon } from "../icons";
import { useApiKeyForm } from "./useApiKeyForm";

/**
 * "OpenCode Zen" free-models tab: connect/change/remove the shared Zen key,
 * then browse the free model catalog. Fully self-contained — owns its own
 * key-entry form state so it never interferes with the Providers tab.
 */
export function FreeModelsTabContent() {
  const authed = useStore((s) => s.authed);
  const removeKey = useStore((s) => s.removeKey);
  const { values, saving, setValue, handleSave } = useApiKeyForm();
  const [editingZen, setEditingZen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const zenConfigured = !!authed[ZEN_PROVIDER_ID];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-amber-500 flex items-center justify-center">
            🎁
          </div>
          <div>
            <div className="font-semibold">Бесплатные модели</div>
            <div className="text-xs text-muted-foreground">
              {ZEN_FREE_MODELS.length} бесплатных моделей через OpenCode Zen —
              один ключ открывает все.
            </div>
          </div>
        </div>
        <a
          className="text-sm text-primary hover:underline"
          href="https://opencode.ai/auth"
          target="_blank"
          rel="noreferrer"
        >
          Получить бесплатный ключ →
        </a>
      </div>

      {zenConfigured && !editingZen ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-emerald-300">
            <CheckIcon size={16} /> OpenCode Zen подключён — все бесплатные
            модели доступны
          </span>
          <div className="flex gap-3 text-xs">
            <button
              className="text-primary hover:underline"
              onClick={() => {
                setEditingZen(true);
                setValue(ZEN_PROVIDER_ID, "");
              }}
              type="button"
            >
              Сменить ключ
            </button>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => removeKey(ZEN_PROVIDER_ID)}
              type="button"
            >
              Удалить
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            type="password"
            placeholder="Вставьте API-ключ OpenCode Zen"
            value={values[ZEN_PROVIDER_ID] ?? ""}
            onChange={(e) => setValue(ZEN_PROVIDER_ID, e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              handleSave(ZEN_PROVIDER_ID)
                .then((ok) => {
                  if (ok && mountedRef.current) setEditingZen(false);
                })
                .catch(() => {})
            }
            className="max-w-sm"
            autoFocus={editingZen}
          />
          <Button
            disabled={
              !values[ZEN_PROVIDER_ID]?.trim() || saving === ZEN_PROVIDER_ID
            }
            onClick={() => {
              handleSave(ZEN_PROVIDER_ID)
                .then((ok) => {
                  if (ok && mountedRef.current) setEditingZen(false);
                })
                .catch(() => {});
            }}
          >
            {saving === ZEN_PROVIDER_ID
              ? "Подключение…"
              : editingZen
                ? "Сохранить ключ"
                : "Подключить бесплатные модели"}
          </Button>
          {editingZen && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditingZen(false);
                setValue(ZEN_PROVIDER_ID, "");
              }}
              type="button"
            >
              Отмена
            </Button>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ZEN_FREE_MODELS.map((m) => (
          <div
            key={m.id}
            className="rounded-xl border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {m.badge}
              </span>
              <span className="truncate">{m.name}</span>
              <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">
                FREE
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{m.best}</p>
            <div className="text-[11px] text-muted-foreground mt-2 flex gap-3">
              <span>⏷ {m.context} ctx</span>
              {m.sweBench && <span>◆ {m.sweBench} SWE</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
        <span>⚠️</span>
        <span>
          Бесплатные модели могут использовать ваши данные для обучения.
          Не отправляйте им чувствительный или коммерческий код.
        </span>
      </div>
    </div>
  );
}
