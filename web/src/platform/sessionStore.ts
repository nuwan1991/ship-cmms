/** Session token for this browser tab only (sessionStorage), with an in-memory copy. Storage can be blocked or empty; nothing depends on it. */
const KEY = 'cmms.session';
let memory: string | null = null;

export function getToken(): string | null {
  if (memory !== null) return memory;
  try {
    memory = sessionStorage.getItem(KEY);
  } catch {
    /* storage unavailable: stay signed out after reload */
  }
  return memory;
}

export function setToken(token: string | null): void {
  memory = token;
  try {
    if (token === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, token);
  } catch {
    /* in-memory only */
  }
}
