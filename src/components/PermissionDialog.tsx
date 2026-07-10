import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export default function PermissionDialog() {
  const permissions = useStore((s) => s.permissions);
  const respond = useStore((s) => s.respondPermission);

  const open = permissions.length > 0;
  const req = permissions[0];
  const queueLen = permissions.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && req) respond(req.id, false);
      }}
    >
      <DialogContent className="max-w-md gap-0 p-0 sm:rounded-2xl">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Permission requested</DialogTitle>
            {queueLen > 1 && (
              <Badge variant="secondary" className="shrink-0">
                1 of {queueLen}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {req && (
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              OpenCode wants to run a tool. Approve to let it proceed.
            </p>

            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
              <span className="font-mono text-sm font-semibold">{req.tool ?? "tool"}</span>
            </div>

            {req.input != null && (
              <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
                {fmt(req.input)}
              </pre>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => respond(req.id, false)}>
                Deny
              </Button>
              <Button onClick={() => respond(req.id, true)}>Allow</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
