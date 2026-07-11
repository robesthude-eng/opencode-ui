import { ChevronDown, FileArchive, FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import React, { type ComponentPropsWithoutRef, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { formatSize } from "../api/files";
import type { Part } from "../api/types";
import CopyButton from "./CopyButton";
import ToolCard from "./ToolCard";

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
      const child = React.Children.only(children) as React.ReactElement<{
        children?: string | string[];
      }>;
      if (child?.props && typeof child.props.children === "string") {
        codeText = child.props.children;
      } else if (child?.props && Array.isArray(child.props.children)) {
        codeText = child.props.children.join("");
      }
    } catch {
      // fallback
    }
    return (
      <div className="group/code relative my-2 overflow-hidden rounded-lg bg-black/30 dark:bg-black/40">
        <div className="absolute right-2 top-2 z-10 opacity-60 transition group-hover/code:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyButton text={codeText || String(children)} title="Copy code" />
        </div>
        <pre
          className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-foreground/90"
          {...props}
        >
          {children}
        </pre>
      </div>
    );
  },
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[13px]", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
} as Components;

const HIDDEN_TYPES = new Set(["file"]);

const KIND_ICONS: Record<string, ReactNode> = {
  image: <ImageIcon className="h-4 w-4" />,
  pdf: <FileText className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  zip: <FileArchive className="h-4 w-4" />,
  binary: <Paperclip className="h-4 w-4" />,
};

const STEP_TYPES = new Set(["step-start", "step-finish", "step-reasoning"]);

const markdownPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

const OptimizedPartView = ({
  part,
  isLastStreaming,
}: {
  part: Part;
  isLastStreaming?: boolean;
}) => {
  const p = part as { type?: string; text?: string };
  if (HIDDEN_TYPES.has(p.type ?? "")) return null;

  const renderMarkdown = (text: string) => (
    <ReactMarkdown
      remarkPlugins={markdownPlugins}
      rehypePlugins={rehypePlugins}
      components={SAFE_MD_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );

  if (STEP_TYPES.has(p.type ?? "")) {
    if (!p.text) return null;
    return (
      <div className="text-sm text-muted-foreground">
        {renderMarkdown(p.text)}
        {isLastStreaming && <span className="streaming-cursor" />}
      </div>
    );
  }

  switch (p.type) {
    case "attachment": {
      const att = part as {
        type: string;
        name?: string;
        size?: number;
        kind?: string;
        path?: string;
        dataUrl?: string;
      };
      const icon = KIND_ICONS[att.kind || ""] || <Paperclip className="h-4 w-4" />;
      return (
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/35 px-2.5 py-2 text-sm not-prose">
          {att.kind === "image" && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/60 text-muted-foreground">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{att.name || "file"}</div>
            <div className="text-xs text-muted-foreground">{formatSize(att.size || 0)}</div>
          </div>
        </div>
      );
    }
    case "text":
      if (!p.text) return null;
      return (
        <div className="break-words text-[14.5px] leading-[1.55] [&_p]:my-1.5 [&_pre]:my-2 [&_ul]:my-1.5 [&_ol]:my-1.5">
          {renderMarkdown(p.text)}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
    case "reasoning":
      if (!p.text) return null;
      return (
        <details className="not-prose group my-1 overflow-hidden" open={!!isLastStreaming}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[12.5px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden hover:text-foreground/80">
            <span className="text-[13px] opacity-80">💭</span>
            <span className="flex-1">Рассуждение</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60 transition group-open:rotate-180" />
          </summary>
          <div className="pl-0.5 pb-1 text-[13px] leading-relaxed text-muted-foreground prose prose-invert prose-sm max-w-none prose-p:my-1.5">
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
        <div className="break-words text-[14.5px] leading-[1.55] [&_p]:my-1.5 [&_pre]:my-2">
          {renderMarkdown(p.text)}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
  }
};

export default memo(OptimizedPartView);
