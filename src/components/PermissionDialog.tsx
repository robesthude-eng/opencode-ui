import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "../store/useStore";

function fmt(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// OpenCode 1.18+ expects "once" | "always" | "reject" for permission responses
// (older versions used "allow" | "deny"). We send the new enum; the server
// validates the body strictly, so anything else is a 400.
type PermissionResponse = "once" | "always" | "reject";

export default function PermissionDialog() {
  const permissions = useStore((s) => s.permissions);
  const respond = useStore((s) => s.respondPermission);

  const open = permissions.length > 0;
  const req = permissions[0];
  const queueLen = permissions.length;

  const answer = (r: PermissionResponse) => {
    if (req) respond(req.id, r);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismiss via backdrop/Esc -> reject
        if (!next && req) answer("reject");
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Запрос разрешения</DialogTitle>
            {queueLen > 1 && (
              <Badge variant="secondary" className="shrink-0">
                1 из {queueLen}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {req && (
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Ассистент хочет запустить инструмент. Разрешите продолжить.
            </p>

            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
              <span className="font-mono text-sm font-semibold">
                {typeof req.tool === "string" && req.tool ? req.tool : "tool"}
              </span>
            </div>

            {req.input != null && (
              <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
                {fmt(req.input)}
              </pre>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => answer("reject")}>
                Отклонить
              </Button>
              {/* "once" is the safe default — allow this single call only */}
              <Button onClick={() => answer("once")}>Разрешить</Button>
              <Button
                variant="secondary"
                onClick={() => answer("always")}
                title="Разрешать все такие вызовы до конца сессии"
              >
                Всегда
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
