import { initialsFor } from './avatar';

// A small circular profile picture, or a generated initials badge when the person hasn't set one
// - used in both the header (always visible, unlike the name text next to it) and the Profile
// page itself.
export function Avatar({ name, avatarUrl, size = 28 }: { name: string | undefined | null; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full flex items-center justify-center shrink-0 font-semibold leading-none"
      style={{ width: size, height: size, fontSize: size * 0.4, background: 'var(--primary)', color: 'var(--on-primary)' }}
    >
      {initialsFor(name)}
    </span>
  );
}
