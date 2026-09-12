import React, { useEffect, useMemo, useState } from 'react';
import type { ThemeStyleId, ThemeModeId, PaletteId } from './tokens';
import { DEFAULT_PALETTE, PALETTES_BY_STYLE, getCanvasTokens, getPaletteColors, isPaletteForStyle, isThemeId } from './tokens';
import { ThemeContext } from './context';

const STYLE_STORAGE_KEY = 'ea-designer.theme-style';
const MODE_STORAGE_KEY = 'ea-designer.theme-mode';
const PALETTES_STORAGE_KEY = 'ea-designer.theme-palettes';

function readStoredStyle(): ThemeStyleId {
  try {
    const saved = localStorage.getItem(STYLE_STORAGE_KEY);
    if (saved === 'ea' || saved === 'm3') return saved;
  } catch {
    // localStorage unavailable (private mode, etc) - fall through to default
  }
  return 'ea';
}

function readStoredMode(): ThemeModeId {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

// Each style remembers its own last-picked palette, so switching from EA to M3 and back doesn't
// lose either one's selection.
function readStoredPalettes(): Record<ThemeStyleId, PaletteId> {
  const fallback = { ...DEFAULT_PALETTE };
  try {
    const saved = localStorage.getItem(PALETTES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Record<ThemeStyleId, string>>;
      (Object.keys(fallback) as ThemeStyleId[]).forEach(style => {
        const value = parsed[style];
        if (value && isPaletteForStyle(style, value)) fallback[style] = value;
      });
    }
  } catch {
    // ignore malformed/unavailable storage
  }
  return fallback;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyle] = useState<ThemeStyleId>(readStoredStyle);
  const [mode, setMode] = useState<ThemeModeId>(readStoredMode);
  const [palettesByStyle, setPalettesByStyle] = useState<Record<ThemeStyleId, PaletteId>>(readStoredPalettes);

  const palette = palettesByStyle[style];
  const themeId = `${style}-${mode}` as const;

  useEffect(() => {
    const candidate = `${style}-${mode}`;
    const resolved = isThemeId(candidate) ? candidate : 'ea-light';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.palette = palette;

    // The canvas (React Flow nodes/edges) and the header/button accent colors can't be reached by
    // an ancestor stylesheet the way ordinary DOM can (React Flow paints via inline SVG styles;
    // the header/buttons need the palette-specific value at paint time). Mirror the palette's
    // colors onto CSS custom properties instead, so plain elements read them via var() without
    // having to re-render on every theme/palette change, while tokens.ts stays the single source
    // of truth.
    const canvas = getCanvasTokens(style, palette, mode);
    const paletteColors = getPaletteColors(style, palette, mode);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--node-bg', canvas.nodeBg);
    rootStyle.setProperty('--node-border', canvas.nodeBorder);
    rootStyle.setProperty('--node-text', canvas.nodeText);
    rootStyle.setProperty('--junction-color', canvas.junctionColor);
    rootStyle.setProperty('--critical-dot', canvas.criticalDotColor);
    rootStyle.setProperty('--primary', paletteColors.primary);
    rootStyle.setProperty('--primary-hover', paletteColors.primaryHover);
    rootStyle.setProperty('--on-primary', paletteColors.onPrimary);
    rootStyle.setProperty('--primary-container', paletteColors.primaryContainer);
    rootStyle.setProperty('--on-primary-container', paletteColors.onPrimaryContainer);
    // Only m3 palettes tint the header; ea keeps theme.css's fixed dark header, so clear any
    // inline override left behind by a previous m3 selection - otherwise it would keep beating
    // the stylesheet's `[data-theme='ea-*']` value, since an inline style always wins regardless
    // of selector specificity.
    if (paletteColors.headerBg) {
      rootStyle.setProperty('--bg-header', paletteColors.headerBg);
    } else {
      rootStyle.removeProperty('--bg-header');
    }

    try {
      localStorage.setItem(STYLE_STORAGE_KEY, style);
      localStorage.setItem(MODE_STORAGE_KEY, mode);
      localStorage.setItem(PALETTES_STORAGE_KEY, JSON.stringify(palettesByStyle));
    } catch {
      // ignore persistence failures
    }
  }, [style, mode, palette, palettesByStyle]);

  const value = useMemo(() => ({
    style,
    mode,
    palette,
    themeId,
    tokens: getCanvasTokens(style, palette, mode),
    palettesForStyle: PALETTES_BY_STYLE[style],
    setStyle,
    setMode,
    setPalette: (p: PaletteId) => setPalettesByStyle(prev => ({ ...prev, [style]: p })),
    toggleMode: () => setMode(m => (m === 'light' ? 'dark' : 'light')),
  }), [style, mode, palette, themeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
