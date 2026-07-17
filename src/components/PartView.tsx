import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react";
import React, {
  type ComponentPropsWithoutRef,
  memo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { formatSize } from "../api/files";
import type { Part, ToolPart } from "../api/types";
import CopyButton from "./CopyButton";
import { ThinkIcon } from "./icons";
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
    let language = "plaintext";
    try {
      const child = React.Children.only(children) as React.ReactElement<{
        className?: string;
        children?: string | string[];
      }>;
      const className = child?.props?.className || "";
      const match = className.match(/language-(\w+)/);
      if (match) {
        language = match[1];
      }
      if (child?.props && typeof child.props.children === "string") {
        codeText = child.props.children;
      } else if (child?.props && Array.isArray(child.props.children)) {
        codeText = child.props.children.join("");
      }
    } catch {
      // fallback
    }
    return (
      <div className="group/code relative my-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]">
              {language}_block
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5 rounded bg-background/50 border border-border">
              {language}
            </span>
            <CopyButton text={codeText || String(children)} title="Copy code" className="h-6 w-6" />
          </div>
        </div>
        <pre
          className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-foreground/90 bg-background/40"
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

const asText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
};

const markdownPlugins = [remarkGfm, remarkBreaks];
const rehypePlugins = [rehypeHighlight];

function useThinkingDuration(streaming?: boolean): string {
  const [startedAt] = useState(() => Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    if (streaming) {
      const id = setInterval(() => setTick((t) => t + 1), 500);
      return () => clearInterval(id);
    }
  }, [streaming]);

  const end = streaming ? Date.now() : Date.now();
  const secs = Math.max(0, Math.round((end - startedAt) / 1000));
  return secs <= 1 ? "1 секунду" : `${secs} секунд`;
}

function ReasoningCard({ text, streaming }: { text: string; streaming?: boolean }) {
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null);
  const expanded = manuallyToggled ?? !!streaming;
  const duration = useThinkingDuration(streaming);

  return (
    <div className="not-prose my-1">
      {/* Ghost-строка заголовка reasoning */}
      <button
        type="button"
        className="group/reason flex w-full items-center gap-2 px-2 py-1.5 text-left rounded-lg hover:bg-accent/30 transition cursor-pointer"
        onClick={() => setManuallyToggled((e) => (e === null ? false : !e))}
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground",
            streaming && "animate-pulse text-violet-400",
          )}
        >
          <ThinkIcon size={15} />
        </span>
        <span className="text-[13px] font-medium text-foreground/85">
          {streaming ? "Размышляет" : "Думал"}
        </span>
        {streaming && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
        )}
        {!streaming && duration && (
          <span className="text-[11.5px] text-muted-foreground/70">{duration}</span>
        )}
        <span className="flex-1" />
        <span className="text-muted-foreground/50 shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {/* Раскрытый reasoning-текст */}
      {expanded && (
        <div
          className="mt-1.5 ml-6 rounded-lg border border-border px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground/90 prose prose-sm max-w-none prose-p:my-1.5 [&_*]:text-muted-foreground/90"
          style={{ background: "color-mix(in srgb, var(--color-card) 100%, white 4%)" }}
        >
          <ReactMarkdown
            remarkPlugins={markdownPlugins}
            rehypePlugins={rehypePlugins}
            components={SAFE_MD_COMPONENTS}
          >
            {text}
          </ReactMarkdown>
          {streaming && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
}

const OptimizedPartView = ({
  part,
  isLastStreaming,
}: {
  part: Part;
  isLastStreaming?: boolean;
}) => {
  if (!part || typeof part !== "object") return null;
  const p = part as { type?: string; text?: unknown };
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
    const t = asText(p.text);
    if (!t) return null;
    return (
      <div className="text-sm text-muted-foreground opacity-80">
        {renderMarkdown(t)}
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
        <div className="break-words text-[14.5px] leading-relaxed [&_p]:my-2 [&_pre]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_li]:my-1 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:my-2 [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
          {renderMarkdown(asText(p.text))}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
    case "reasoning":
      if (!p.text) return null;
      return <ReasoningCard text={asText(p.text)} streaming={isLastStreaming} />;
    case "tool":
      return <ToolCard part={part as ToolPart} />;
    default:
      if (!p.text) return null;
      return (
        <div className="break-words text-[14.5px] leading-relaxed [&_p]:my-2 [&_pre]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_li]:my-1 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-2 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:my-2 [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
          {renderMarkdown(asText(p.text))}
          {isLastStreaming && <span className="streaming-cursor" />}
        </div>
      );
  }
};

export default memo(OptimizedPartView);
