const KEY = 'payscope:last-org';

export function readLastOrgId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberOrgId(orgId: string): void {
  try {
    window.localStorage.setItem(KEY, orgId);
  } catch {
    // Storage can be blocked; the last-org shortcut is optional.
  }
}
