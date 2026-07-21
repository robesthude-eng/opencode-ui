import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { statusText } from "../api/eventGuards";
import { processFile } from "../api/files";
import { useStore } from "../store/useStore";
import { CloseIcon, PaperclipIcon, SendIcon, StopIcon } from "./icons";

export default function Composer() {
  const currentID = useStore((s) => s.currentID);
  const rawStatus = useStore((s) =>
    currentID ? s.status[currentID] : undefined,
  );
  const status = statusText(rawStatus);
  const send = useStore((s) => s.send);
  const abort = useStore((s) => s.abort);
  const attachments = useStore((s) => s.attachments);
  const addAttachments = useStore((s) => s.addAttachments);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const failedSendText = useStore((s) => s.failedSendText);
  const clearFailedSendText = useStore((s) => s.clearFailedSendText);
  const [text, setText] = useState("");
  // P2-fix: очередь сообщений — набранное во время генерации не теряется,
  // а отправляется автоматически, как только сессия освободится.
  const [queued, setQueued] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_uploadProgress, setUploadProgress] = useState<Record<string, number>>(
    {},
  );
  const [_uploadedPaths, setUploadedPaths] = useState<Record<string, string>>(
    {},
  );
  const [uploadError, setUploadError] = useState<string | null>(null);

  const busy =
    status === "busy" ||
    status === "retry" ||
    status === "stale" ||
    status === "orphaned" ||
    status === "submitting" ||
    status === "running";

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    if (!text && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text]);

  // P2-fix: отправка упала — возвращаем текст в поле ввода, чтобы
  // пользователь не набирал его заново.
  useEffect(() => {
    if (failedSendText) {
      setText((t) => (t ? t : failedSendText));
      clearFailedSendText();
    }
  }, [failedSendText, clearFailedSendText]);

  // P2-fix: сессия освободилась — отправляем следующее из очереди.
  // send() ставит busy синхронно, поэтому двойной отправки не будет.
  useEffect(() => {
    if (!busy && queued.length > 0) {
      const [next, ...rest] = queued;
      setQueued(rest);
      if (next) send(next).catch(() => {});
    }
  }, [busy, queued, send]);

  const submit = async () => {
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    // P2-fix: во время генерации Enter не теряет сообщение,
    // а ставит его в очередь.
    if (busy) {
      if (value) {
        setQueued((q) => [...q, value]);
        setText("");
      }
      return;
    }
    setText("");
    await send(value);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const name = file.name;
      setUploadProgress((p) => ({ ...p, [name]: 0 }));
      try {
        const result = await api.uploadFile(
          file,
          (pct) => {
            setUploadProgress((p) => ({ ...p, [name]: pct }));
          },
          currentID,
        );
        setUploadProgress((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
        setUploadedPaths((p) => ({ ...p, [name]: result.path }));
        const processed = await processFile(file);
        processed.uploadedPath = result.path;
        if (result.agentPath) processed.agentPath = result.agentPath;
        if (typeof result.entryCount === "number") {
          processed.entryCount = result.entryCount;
        }
        addAttachments([processed]);
      } catch (err: unknown) {
        setUploadProgress((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
        const msg = (err as Error)?.message || String(err);
        setUploadError(msg);
        setTimeout(() => setUploadError(null), 6000);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="w-full max-w-3xl h-[95.375px] mx-auto px-3 md:px-6 pb-6 pointer-events-none">
      <div
        className={cn(
          "pointer-events-auto w-full transition-all duration-200",
          "bg-card/95 backdrop-blur-md rounded-xl p-2 border border-border shadow-none",
          dragOver && "ring-2 ring-primary bg-primary/5",
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex flex-col gap-1">
          {/* P2-fix: очередь сообщений, ожидающих окончания генерации */}
          {queued.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-1">
              {queued.map((q, i) => (
                <div
                  key={`${i}-${q.slice(0, 12)}`}
                  className="flex items-center gap-2 rounded-full bg-muted border border-border px-2 py-1 text-xs text-muted-foreground"
                  title={q}
                >
                  <span className="opacity-60">⏳</span>
                  <span className="truncate max-w-[160px]">{q}</span>
                  <button
                    type="button"
                    className="hover:text-destructive"
                    onClick={() =>
                      setQueued((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Attachments row */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pb-2">
              {attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-full bg-muted border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  <span className="truncate max-w-[120px]">{att.name}</span>
                  <button
                    type="button"
                    className="hover:text-destructive"
                    onClick={() => removeAttachment(att.name)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input area */}
          <div className="flex items-end gap-2 px-2 py-1 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
            >
              <PaperclipIcon size={18} />
            </Button>
            <input
              type="file"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Что хотите сделать?"
              className="flex-1 min-h-[40px] max-h-[200px] bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 text-foreground placeholder:text-muted-foreground resize-none py-2 text-[15px] leading-relaxed"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                grow(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex items-center gap-1 pb-1">
              {busy ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
                  onClick={() => abort()}
                  title="Stop"
                >
                  <StopIcon size={18} />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className={cn(
                    "h-9 w-9 shrink-0 rounded-full transition-all",
                    canSend
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                  onClick={submit}
                  disabled={!canSend}
                  title="Send"
                >
                  <SendIcon size={18} />
                </Button>
              )}
            </div>
          </div>
        </div>
        {uploadError && (
          <div className="absolute -top-8 left-0 right-0 text-center text-xs text-red-400 animate-in fade-in slide-in-from-bottom-1">
            {uploadError}
          </div>
        )}
      </div>
    </div>
  );
}
