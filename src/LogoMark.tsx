// The app's mark: three connected system chips, echoing the same rounded-rect nodes and lines
// the canvas itself draws. Uses currentColor so it always matches surrounding text without a
// separate asset per theme/palette; the static public/favicon.svg carries a fixed-color version
// for the browser tab, where CSS custom properties aren't available. Lives outside App.tsx so the
// standalone auth screens (which render before the rest of the app does) can use it too.
export const LogoMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M9 13 L16 19 M23 13 L16 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    <rect x="4" y="6" width="10" height="7" rx="2" fill="currentColor" />
    <rect x="18" y="6" width="10" height="7" rx="2" fill="currentColor" />
    <rect x="11" y="19" width="10" height="7" rx="2" fill="currentColor" />
  </svg>
);
