import React, { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

export default function CopyButton({ text, title, className }: { text: string; title?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      className={`copy-btn ${copied ? "copied" : ""} ${className ?? ""}`}
      onClick={handleCopy}
      title={copied ? "Copied!" : (title ?? "Copy")}
      type="button"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}
