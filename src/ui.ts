// Shared building-block classes so every panel/button/input across the app - including the
// standalone auth screens, which render before the rest of App.tsx does - picks up the active
// theme's tokens (colors, radii, shadows) uniformly instead of each call site hardcoding its own
// palette. Lives outside App.tsx so auth views can import it without a circular dependency.
export const inputClass = 'w-full px-2.5 py-1.5 border rounded-[var(--radius-input)] bg-[var(--bg-input)] text-[var(--text-primary)] border-[var(--border)] shadow-sm text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] outline-none transition-colors';
export const buttonPrimaryClass = 'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-button)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-semibold shadow-[var(--shadow-sm)] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-40';
export const buttonDangerClass = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-button)] bg-[var(--danger)] text-[var(--on-danger)] text-sm font-semibold shadow-[var(--shadow-sm)] hover:bg-[var(--danger-hover)] transition-colors';
export const buttonSecondaryClass = 'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--bg-surface-alt)] transition-colors disabled:opacity-40';
export const cardClass = 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-card)] shadow-[var(--shadow-sm)]';
export const panelHeadingClass = 'font-bold text-lg border-b border-[var(--border-subtle)] pb-2 text-[var(--text-primary)]';
export const labelClass = 'block text-xs font-bold mb-1 text-[var(--text-secondary)]';
export const listItemCardClass = 'bg-[var(--bg-surface)] p-2 rounded-[var(--radius-input)] border border-[var(--border-subtle)] shadow-[var(--shadow-sm)]';
