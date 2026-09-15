import { apiFetch } from '../api';

// Fire-and-forget: pings the audit trail that a specific record (not a list, not a background
// poll) was opened for viewing. Deliberately never awaited by callers and never throws - a missed
// view log shouldn't block navigation or surface an error to the user, the same trade-off the
// backend's logAudit makes for write failures.
export function logAuditView(resourceType: string, resourceId: string | null, resourceLabel?: string | null): void {
  apiFetch('/audit/log-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType, resourceId, resourceLabel: resourceLabel ?? null }),
  }).catch(() => { /* best-effort */ });
}
