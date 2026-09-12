const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || '4001';
// Use the host the app was loaded from (not a hardcoded "localhost") so this also works
// when the app is accessed via a LAN IP or a real domain, not just from the server itself.
export const API_BASE = `http://${window.location.hostname}:${BACKEND_PORT}/api`;

// The backend session cookie is set on the API's own origin (a different port than the frontend),
// which browsers treat as cross-origin - `credentials: 'include'` is required on every request or
// the cookie is silently never sent/stored.
export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { ...options, credentials: 'include' });
}

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
};

export async function parseJsonOrError(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}
