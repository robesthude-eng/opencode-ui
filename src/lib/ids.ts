export const ID_PREFIX = {
  TMP: "tmp_",
  LOCAL: "local_",
  SESSION: "ses_",
  MESSAGE: "msg_",
} as const;

export function isTmpSession(id?: string | null): boolean {
  return typeof id === "string" && id.startsWith(ID_PREFIX.TMP);
}

export function isLocalMessage(id?: string | null): boolean {
  return typeof id === "string" && id.startsWith(ID_PREFIX.LOCAL);
}

export function isSessionId(id?: string | null): boolean {
  return typeof id === "string" && id.startsWith(ID_PREFIX.SESSION);
}
