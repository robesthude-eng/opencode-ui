import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { SendIcon, StopIcon, PaperclipIcon, CloseIcon } from "./icons";
import { processFile, formatSize, ACCEPTED_EXTENSIONS } from "../api/files";
import { api } from "../api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Composer() {
  const currentID = useStore((s) => s.currentID);
  const rawStatus = useStore((s) => (currentID ? s.status[currentID] : undefined));
  const status = typeof rawStatus === "string" ? rawStatus : (rawStatus as any)?.type || "idle";
  const send = useStore((s) => s.send);
  const abort = useStore((s) => s.abort);
  const attachments = useStore((s) => s.attachments);
  const addAttachments = useStore((s) => s.addAttachments);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadedPaths, setUploadedPaths] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);

  const busy = status === "busy" || status === "retry";

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  useEffect(() => {
    if (!text && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if ((!value && attachments.length === 0) || busy) return;
    setText("");
    await send(value);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const name = file.name;
      setUploadProgress((p) => ({ ...p, [name]: 0 }));
      try {
        const result = await api.uploadFile(file, (pct) => {
          setUploadProgress((p) => ({ ...p, [name]: pct }));
        }, currentID);
        setUploadProgress((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
        setUploadedPaths((p) => ({ ...p, [name]: result.path }));
        const processed = await processFile(file);
        (processed as any).uploadedPath = result.path;
        if (typeof result.entryCount === "number") {
          (processed as any).entryCount = result.entryCount;
        }
        addAttachments([processed]);
      } catch (err: any) {
        setUploadProgress((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
        const msg = err?.message || String(err);
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

  const canSend = (text.trim() || attachments.length > 0) && !busy;

  return (
    <div
      className={cn(
        "border-t border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "px-3 md:px-6 pt-3 pb-4",
        dragOver && "ring-2 ring-primary ring-inset bg-primary/5"
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-3xl">
        {dragOver && (
          <div className="mb-2 rounded-xl border border-dashed border-primary/60 bg-primary/5 px-3 py-2 text-sm text-primary text-center">
            📎 Drop files to attach
          </div>
        )}

        {(attachments.length > 0 || Object.keys(uploadProgress).length > 0 || uploadError) && (
          <div className="mb-2 space-y-2">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.name}
                    title={`${a.name} (${formatSize(a.size)})`}
                    className="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
                  >
                    <div className="relative">
                      {a.kind === "image" && a.dataUrl ? (
                        <img src={a.dataUrl} alt={a.name} className="h-6 w-6 rounded-md object-cover" />
                      ) : (
                        <span className="text-[13px]">
                          {a.kind === "zip" ? "🗜️" : a.kind === "image" ? "🖼️" : a.kind === "pdf" ? "📄" : "📎"}
                        </span>
                      )}
                      {(a as any).uploadedPath && (
                        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] text-white">✓</span>
                      )}
                    </div>
                    <span className="max-w-[140px] truncate font-medium">{a.name}</span>
                    <span className="text-muted-foreground">{formatSize(a.size)}</span>
                    <button
                      className="rounded-full p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition"
                      onClick={() => {
                        removeAttachment(a.name);
                        setUploadedPaths((p) => { const n = { ...p }; delete n[a.name]; return n; });
                      }}
                      aria-label="Remove"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(uploadProgress).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(uploadProgress).map(([name, pct]) => (
                  <div key={name} className="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs">
                    <svg className="h-6 w-6 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" className="text-muted" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15" fill="none"
                        stroke="currentColor" className="text-primary"
                        strokeWidth="3"
                        strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="max-w-[140px] truncate">{name}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                ))}
              </div>
            )}
            {uploadError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {uploadError}
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ""; }}
        />

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card shadow-sm px-2 py-2 focus-within:ring-2 focus-within:ring-primary/40">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
          >
            <PaperclipIcon />
          </Button>

          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            placeholder={currentID ? "Message…" : "Start a new chat to begin"}
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm py-2 px-1 resize-none max-h-[200px] min-h-[36px]"
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />

          {busy ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="shrink-0 rounded-xl"
              onClick={() => abort()}
              title="Stop"
            >
              <StopIcon />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="shrink-0 rounded-xl"
              onClick={submit}
              disabled={!canSend}
              title="Send"
            >
              <SendIcon />
            </Button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">
          Shift+Enter for new line • Drag & drop files to attach
        </div>
      </div>
    </div>
  );
}
