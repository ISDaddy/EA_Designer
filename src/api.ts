import type { ThemePrefs } from './theme/tokens';

// A relative path, not an absolute URL with its own port - the frontend's own server (nginx in
// Docker, Vite's dev server locally - see vite.config.ts) reverse-proxies /api to the backend.
// This keeps the app on one origin no matter how it's reached (LAN IP, localhost, or a domain
// behind a tunnel/reverse proxy like Cloudflare), which a separate backend port can't survive -
// nothing outside the LAN can be expected to have that second port forwarded to it.
export const API_BASE = '/api';

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { ...options, credentials: 'include' });
}

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'editor' | 'system_owner' | 'viewer';
  language: string;
  timeZone: string | null;
  // Which version of the NDA (see server/nda.js) this user has accepted, if any - compared
  // against the current version by NdaGate to decide whether they need to (re-)accept it.
  ndaAcceptedVersion: string | null;
  themePrefs: ThemePrefs | null;
  avatarUrl: string | null;
  totpEnabled: boolean;
  // Per-notification-type email opt-out (see notify() in server/index.js) - a missing entry or
  // explicit `true` means email stays on for that type; in-app notifications are never opt-out-able.
  notificationEmailPrefs: Record<string, boolean>;
};

export async function parseJsonOrError(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}
