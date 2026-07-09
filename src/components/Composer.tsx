import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import { SendIcon, StopIcon, PaperclipIcon, CloseIcon } from "./icons";
import { processFile, formatSize, ACCEPTED_EXTENSIONS, type ProcessedFile } from "../api/files";
import { api } from "../api/client";

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
  // Upload progress: filename -> progress 0..100
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  // Uploaded file paths: filename -> server path
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
    // Match the send button's own enabled/disabled rule: a message with no text
    // is still sendable as long as there's at least one attachment (the store's
    // send() already builds attachment parts even when text is empty).
    if ((!value && attachments.length === 0) || busy) return;
    setText("");
    await send(value);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const name = file.name;
      // Set initial progress
      setUploadProgress((p) => ({ ...p, [name]: 0 }));
      try {
        const result = await api.uploadFile(file, (pct) => {
          setUploadProgress((p) => ({ ...p, [name]: pct }));
        }, currentID);
        // Upload done — store path info
        setUploadProgress((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
        setUploadedPaths((p) => ({ ...p, [name]: result.path }));
        // Now process the file for preview/attachment
        const processed = await processFile(file);
        // Attach the server path for use in chat message
        (processed as any).uploadedPath = result.path;
        // For zips: how many files are inside (read-only peek, nothing extracted to disk)
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
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`composer-wrap ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && <div className="drop-hint">📎 Drop files to attach</div>}

      {(attachments.length > 0 || Object.keys(uploadProgress).length > 0 || uploadError) && (
        <div className="composer-meta">
          {attachments.length > 0 && (
            <div className="attachment-chips">
              {attachments.map((a) => (
                <span className="attach-chip" key={a.name} title={`${a.name} (${formatSize(a.size)})`}>
                  <span className={`attach-icon-wrap ${(a as any).uploadedPath ? "uploaded" : ""}`}>
                    {a.kind === "image" && a.dataUrl ? (
                      <img src={a.dataUrl} alt={a.name} className="attach-preview" />
                    ) : (
                      <span className="attach-icon">
                        {a.kind === "zip" ? "🗜️" : a.kind === "image" ? "🖼️" : a.kind === "pdf" ? "📄" : "📎"}
                      </span>
                    )}
                    {(a as any).uploadedPath && <span className="attach-check">✓</span>}
                  </span>
                  <span className="attach-chip-name">{a.name}</span>
                  <span className="attach-chip-size muted">{formatSize(a.size)}</span>
                  <button
                    className="attach-chip-x"
                    onClick={() => {
                      removeAttachment(a.name);
                      setUploadedPaths((p) => { const n = {...p}; delete n[a.name]; return n; });
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {Object.keys(uploadProgress).length > 0 && (
            <div className="attachment-chips">
              {Object.entries(uploadProgress).map(([name, pct]) => (
                <span className="attach-chip uploading" key={name}>
                  <svg className="upload-circle" width="24" height="24" viewBox="0 0 36 36">
                    <circle className="upload-circle-bg" cx="18" cy="18" r="15" />
                    <circle
                      className="upload-circle-fill"
                      cx="18" cy="18" r="15"
                      strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
                    />
                    <text x="18" y="21" className="upload-circle-text">{pct}</text>
                  </svg>
                  <span className="attach-chip-name">{name}</span>
                  <span className="attach-chip-size muted">Uploading…</span>
                </span>
              ))}
            </div>
          )}
          {uploadError && (
            <div className="upload-error">{uploadError}</div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        className="file-input-hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="composer">
        <button
          className="icon-btn attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          placeholder={currentID ? "Message…" : "Start a new chat to begin"}
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
        {busy ? (
          <button className="icon-btn stop" onClick={() => abort()} title="Stop">
            <StopIcon />
          </button>
        ) : (
          <button
            className="icon-btn send"
            onClick={submit}
            disabled={!text.trim() && attachments.length === 0}
            title="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}
