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

  if (permissions.length === 0) return null;
  const req = permissions[0];
  const queueLen = permissions.length;

  return (
    <div className="overlay">
      <div className="dialog">
        <div className="perm-header">
          <h3>Permission requested</h3>
          {queueLen > 1 && (
            <span className="perm-queue muted small">1 of {queueLen}</span>
          )}
        </div>
        <p className="muted">
          OpenCode wants to run a tool. Approve to let it proceed.
        </p>
        <div className="perm-tool">
          <span className="tool-name">{req.tool ?? "tool"}</span>
        </div>
        {req.input != null && (
          <pre className="perm-input">{fmt(req.input)}</pre>
        )}
        <div className="dialog-actions">
          <button className="btn-ghost" onClick={() => respond(req.id, false)}>
            Deny
          </button>
          <button className="btn-primary" onClick={() => respond(req.id, true)}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
