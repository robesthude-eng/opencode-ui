import React, { useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";

interface PreviewPanelProps {
  url: string;
}

export function PreviewPanel({ url }: PreviewPanelProps) {
  const [key, setKey] = useState(0); // Used to force reload iframe
  const [loading, setLoading] = useState(true);

  const handleRefresh = () => {
    setLoading(true);
    setKey((prev) => prev + 1);
  };

  const handleOpenExternal = () => {
    window.open(url, "_blank");
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <span className="truncate max-w-[200px]">{url}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} title="Refresh">
            <RefreshCw size={14} className={loading && url ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenExternal} title="Open in new tab">
            <ExternalLink size={14} />
          </Button>
        </div>
      </div>
      <div className="relative flex-1 bg-white">
        {/* Placeholder if url is missing */}
        {!url && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No preview URL available
          </div>
        )}
        {url && (
          <iframe
            key={key}
            src={url}
            className="h-full w-full border-none"
            title="Preview"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            onLoad={() => setLoading(false)}
          />
        )}
      </div>
    </div>
  );
}
