import type { ReactNode } from "react";

/**
 * Атомы настроек — единые кирпичи для всех разделов.
 * Любой новый раздел («Настройки чата», «Подключение MCP»)
 * собирается из них — так все разделы гарантированно выглядят одинаково.
 */

/** Секция раздела: заголовок + описание + контент. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** Строка настройки: название и описание слева, контрол справа. */
export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="font-semibold text-sm">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {description}
          </div>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
