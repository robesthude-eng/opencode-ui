import {
  Download,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { workspaceDownloadUrl } from "../api/client";
import { formatSize } from "../api/files";
import { useStore } from "../store/useStore";

// Строки вида «📎 name → path …» — служебные подсказки о вложениях,
// которые отправляются агенту вместе с текстом. В UI рендерим их
// кликабельными файл-чипами (скачивание через /api/workspace/download).
export const ATT_LINE_RE = /^📎 .+ → \S+/;

export function splitAttachmentLines(text: string): {
  attLines: string[];
  rest: string;
} {
  if (!text.includes("📎")) return { attLines: [], rest: text };
  const lines = text.split("\n");
  const attLines = lines.filter((l) => ATT_LINE_RE.test(l.trim()));
  if (attLines.length === 0) return { attLines: [], rest: text };
  return {
    attLines,
    rest: lines
      .filter((l) => !ATT_LINE_RE.test(l.trim()))
      .join("\n")
      .trim(),
  };
}

const KIND_ICONS: Record<string, ReactNode> = {
  image: <ImageIcon className="h-4 w-4" />,
  pdf: <FileText className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  zip: <FileArchive className="h-4 w-4" />,
  binary: <Paperclip className="h-4 w-4" />,
};

/** Оболочка чипа: ссылка-скачивание, если есть href, иначе обычный div. */
function ChipShell({
  href,
  name,
  children,
}: {
  href?: string | undefined;
  name: string;
  children: ReactNode;
}) {
  const cls =
    "group/att flex max-w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-sm not-prose";
  if (!href) return <div className={cls}>{children}</div>;
  return (
    <a
      href={href}
      download={name}
      title={`Скачать ${name}`}
      className={cn(
        cls,
        "cursor-pointer no-underline transition hover:border-primary/40 hover:bg-accent/30",
      )}
    >
      {children}
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition group-hover/att:text-primary" />
    </a>
  );
}

/** Универсальный чип файла, который уже лежит в workspace сессии. */
export function WorkspaceFileChip({
  name,
  path,
  meta = "Файл в workspace",
}: {
  name: string;
  path: string;
  meta?: string;
}) {
  const currentID = useStore((s) => s.currentID);
  const isZip = /\.zip\b/i.test(name);
  const href =
    path && currentID ? workspaceDownloadUrl(path, currentID) : undefined;
  return (
    <ChipShell href={href} name={name}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
        {isZip ? (
          <FileArchive className="h-4 w-4" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        {meta && (
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
        )}
      </div>
    </ChipShell>
  );
}

/** Чип из служебной 📎-строки («📎 name → uploads/… …»). */
export function AttachmentChip({ line }: { line: string }) {
  const m = /^📎 (.+?) → (\S+)(.*)$/.exec(line.trim());
  const name = m?.[1] ?? "file";
  const filePath = m?.[2] ?? "";
  const meta = (m?.[3] ?? "").replace(/^[\s—-]+/, "").trim() || filePath;
  return <WorkspaceFileChip name={name} path={filePath} meta={meta} />;
}

/** Чип для attachment-части сообщения (вложения из Composer). */
export function AttachmentPartChip({
  att,
}: {
  att: {
    name?: string;
    size?: number;
    kind?: string;
    path?: string;
    dataUrl?: string;
  };
}) {
  const currentID = useStore((s) => s.currentID);
  const name = att.name || "file";
  const icon = KIND_ICONS[att.kind || ""] || <Paperclip className="h-4 w-4" />;
  const href =
    att.path && currentID
      ? workspaceDownloadUrl(att.path, currentID)
      : undefined;
  return (
    <ChipShell href={href} name={name}>
      {att.kind === "image" && att.dataUrl ? (
        <img
          src={att.dataUrl}
          alt={name}
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">
          {formatSize(att.size || 0)}
        </div>
      </div>
    </ChipShell>
  );
}
