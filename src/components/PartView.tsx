import React, { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Part } from "../api/types";
import { ReactNode, ComponentPropsWithoutRef } from "react";
import ToolCard from "./ToolCard";
import CopyButton from "./CopyButton";
import { formatSize } from "../api/files";

const SAFE_MD_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    if (typeof href === "string" && /^javascript:/i.test(href.trim())) {
      return <span>{children as ReactNode}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children as ReactNode}
      </a>
    );
  },
  pre: ({ children, ...props }: ComponentPropsWithoutRef<"pre"> & { children?: ReactNode }) => {
    let codeText = "";
    try {
      const child = React.Children.only(children) as React.ReactElement<{ children?: string | string[] }>;
      if (child && child.props && typeof child.props.children === "string") {
        codeText = child.props.children;
      } else if (child && child.props && Array.isArray(child.props.children)) {
        codeText = child.props.children.join("");
      }
    } catch {
      // fallback
    }
    return (
      <div className="code-block-wrapper">
        <CopyButton text={codeText || String(children)} title="Copy code" />
        <pre {...props}>{children}</pre>
      </div>
    );
  },
} as Components;

const HIDDEN_TYPES = new Set([
  "file",
]);

// File type → icon emoji
const KIND_ICONS: Record<string, string> = {
  image: "🖼️",
  pdf: "📄",
  text: "📄",
  zip: "🗜️",
  binary: "📎",
};

const STEP_TYPES = new Set([
  "step-start",
  "step-finish",
  "step-reasoning",
]);

// Move Markdown plugins to a constant to avoid re-initialization on every render
const markdownPlugins = [remarkGfm];

const OptimizedPartView = ({ part, isLastStreaming }: { part: Part; isLastStreaming?: boolean }) => {
  const p = part as { type?: string; text?: string };
  if (HIDDEN_TYPES.has(p.type ?? "")) return null;
  
  const renderMarkdown = (text: string) => (
    <ReactMarkdown remarkPlugins={markdownPlugins} components={SAFE_MD_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );

  if (STEP_TYPES.has(p.type ?? "")) {
    if (!p.text) return null;
    return (
      <div className="part-step">
        {renderMarkdown(p.text)}
        {isLastStreaming && <span className="streaming-cursor" />}
      </div>
    );
  }

  switch (p.type) {
    case "attachment": {
      const att = part as { type: string; name?: string; size?: number; kind?: string; path?: string; dataUrl?: string };
      const icon = KIND_ICONS[att.kind || ""] || "📎";
      return (
        <div className="attachment-card" key={att.name}>
          {att.kind === "image" && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="attachment-preview" />
          ) : (
            <span className="attachment-icon">{icon}</span>
          )}
          <div className="attachment-info">
            <span className="attachment-name">{att.name || "file"}</span>
            <span className="attachment-meta">{formatSize(att.size || 0)}</span>
          </div>
        </div>
      );
    }
    case "text":
      if (!p.text) return null;
      return (
        <div className="part-text">
          {renderMarkdown(p.text)}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
    case "reasoning":
      if (!p.text) return null;
      return (
        <details className="part-reasoning" open={true}>
          <summary>
            <span className="reasoning-icon">💭</span>
            <span>Рассуждение</span>
            <span className="reasoning-chevron" />
          </summary>
          <div className="reasoning-body">
            {renderMarkdown(p.text)}
            {isLastStreaming && <span className="streaming-cursor" />}
          </div>
        </details>
      );
    case "tool":
      return <ToolCard part={part as any} />;
    default:
      if (!p.text) return null;
      return (
        <div className="part-text">
          {renderMarkdown(p.text)}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
  }
};

export default memo(OptimizedPartView);
