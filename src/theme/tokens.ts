// Theme system: two visual styles (Enterprise Architecture / Material 3 Expressive), each with
// its own set of selectable color palettes, and a light/dark mode for every combination. Most
// colors live as CSS custom properties (see theme.css) so plain Tailwind/CSS elements re-theme
// for free; ThemeContext also mirrors the palette-dependent ones here onto the same CSS custom
// properties so a single source of truth (this file) drives both the DOM and the handful of
// things that can only be styled in JS - React Flow edge/marker strokes and the <Background> dot
// color, which React Flow paints directly via SVG/canvas rather than through classes an ancestor
// stylesheet can reach.

export type ThemeStyleId = 'ea' | 'm3';
export type ThemeModeId = 'light' | 'dark';
export type ThemeId = `${ThemeStyleId}-${ThemeModeId}`;

export const THEME_STYLES: { id: ThemeStyleId; label: string; blurb: string }[] = [
  { id: 'ea', label: 'Enterprise Architecture', blurb: 'ArchiMate-inspired, structured' },
  { id: 'm3', label: 'Material 3 Expressive', blurb: 'Tonal, rounded, expressive' },
];

export type EaPaletteId = 'blue' | 'slate' | 'forest' | 'burgundy' | 'teal' | 'amber';
export type M3PaletteId = 'violet' | 'blue' | 'green' | 'peach' | 'rose' | 'teal';
export type PaletteId = EaPaletteId | M3PaletteId;

export type PaletteDef = { id: PaletteId; label: string; swatch: string };

export const PALETTES_BY_STYLE: Record<ThemeStyleId, PaletteDef[]> = {
  ea: [
    { id: 'blue', label: 'Classic Blue', swatch: '#5b8cbe' },
    { id: 'slate', label: 'Slate', swatch: '#64748b' },
    { id: 'forest', label: 'Forest', swatch: '#3f8b64' },
    { id: 'burgundy', label: 'Burgundy', swatch: '#9f4a5c' },
    { id: 'teal', label: 'Teal', swatch: '#3f9c92' },
    { id: 'amber', label: 'Amber', swatch: '#c58a3f' },
  ],
  m3: [
    { id: 'violet', label: 'Violet', swatch: '#6750a4' },
    { id: 'blue', label: 'Blue', swatch: '#0061a4' },
    { id: 'green', label: 'Green', swatch: '#3d6b32' },
    { id: 'peach', label: 'Peach', swatch: '#8b5000' },
    { id: 'rose', label: 'Rose', swatch: '#9c4057' },
    { id: 'teal', label: 'Teal', swatch: '#006a60' },
  ],
};

export const DEFAULT_PALETTE: Record<ThemeStyleId, PaletteId> = { ea: 'blue', m3: 'violet' };

export const isPaletteForStyle = (style: ThemeStyleId, value: string): value is PaletteId =>
  PALETTES_BY_STYLE[style].some(p => p.id === value);

// Colors that shift with the chosen palette: the accent/brand color pairing (buttons, focus
// rings, the active nav tab) and the canvas node fill. Everything else (surfaces, body text,
// borders, semantic success/warning/danger/info) stays constant across palettes within a style.
type PaletteColorSet = {
  primary: string;
  primaryHover: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  headerBg?: string; // only m3 tints its header with the palette color; ea keeps a fixed dark header
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
};

const EA_PALETTE_COLORS: Record<EaPaletteId, Record<ThemeModeId, PaletteColorSet>> = {
  blue: {
    light: { primary: '#2563eb', primaryHover: '#1d4ed8', onPrimary: '#ffffff', primaryContainer: '#dbeafe', onPrimaryContainer: '#1e40af', nodeBg: '#d3e3f1', nodeBorder: '#5b8cbe', nodeText: '#1f497d' },
    dark: { primary: '#3b82f6', primaryHover: '#60a5fa', onPrimary: '#ffffff', primaryContainer: '#1e3a8a', onPrimaryContainer: '#bfdbfe', nodeBg: '#1e3a5f', nodeBorder: '#5b8cbe', nodeText: '#cfe0f0' },
  },
  slate: {
    light: { primary: '#475569', primaryHover: '#334155', onPrimary: '#ffffff', primaryContainer: '#e2e8f0', onPrimaryContainer: '#1e293b', nodeBg: '#e2e8f0', nodeBorder: '#64748b', nodeText: '#334155' },
    dark: { primary: '#94a3b8', primaryHover: '#cbd5e1', onPrimary: '#0f172a', primaryContainer: '#334155', onPrimaryContainer: '#e2e8f0', nodeBg: '#334155', nodeBorder: '#94a3b8', nodeText: '#e2e8f0' },
  },
  forest: {
    light: { primary: '#15803d', primaryHover: '#166534', onPrimary: '#ffffff', primaryContainer: '#dcfce7', onPrimaryContainer: '#14532d', nodeBg: '#d7ecdc', nodeBorder: '#3f8b64', nodeText: '#1f5c3d' },
    dark: { primary: '#4ade80', primaryHover: '#86efac', onPrimary: '#052e16', primaryContainer: '#14532d', onPrimaryContainer: '#bbf7d0', nodeBg: '#1e3a2c', nodeBorder: '#4ade80', nodeText: '#bbf7d0' },
  },
  burgundy: {
    light: { primary: '#9f1239', primaryHover: '#881337', onPrimary: '#ffffff', primaryContainer: '#fce7ef', onPrimaryContainer: '#881337', nodeBg: '#f3d9e1', nodeBorder: '#9f4a5c', nodeText: '#7a1230' },
    dark: { primary: '#fb7185', primaryHover: '#fda4af', onPrimary: '#4c0519', primaryContainer: '#881337', onPrimaryContainer: '#ffe4e9', nodeBg: '#4a1425', nodeBorder: '#fb7185', nodeText: '#ffe4e9' },
  },
  teal: {
    light: { primary: '#0f766e', primaryHover: '#115e59', onPrimary: '#ffffff', primaryContainer: '#ccfbf1', onPrimaryContainer: '#134e4a', nodeBg: '#cceeea', nodeBorder: '#3f9c92', nodeText: '#0f4c47' },
    dark: { primary: '#2dd4bf', primaryHover: '#5eead4', onPrimary: '#042f2c', primaryContainer: '#134e4a', onPrimaryContainer: '#99f6e4', nodeBg: '#143f3b', nodeBorder: '#2dd4bf', nodeText: '#99f6e4' },
  },
  amber: {
    light: { primary: '#b45309', primaryHover: '#92400e', onPrimary: '#ffffff', primaryContainer: '#fef3c7', onPrimaryContainer: '#78350f', nodeBg: '#fbe8c6', nodeBorder: '#c58a3f', nodeText: '#6b3d0a' },
    dark: { primary: '#fbbf24', primaryHover: '#fcd34d', onPrimary: '#451a03', primaryContainer: '#78350f', onPrimaryContainer: '#fde68a', nodeBg: '#4a2f0d', nodeBorder: '#fbbf24', nodeText: '#fde68a' },
  },
};

const M3_PALETTE_COLORS: Record<M3PaletteId, Record<ThemeModeId, PaletteColorSet>> = {
  violet: {
    light: { primary: '#6750a4', primaryHover: '#7a64b8', onPrimary: '#ffffff', primaryContainer: '#eaddff', onPrimaryContainer: '#21005d', headerBg: '#6750a4', nodeBg: '#eaddff', nodeBorder: '#6750a4', nodeText: '#21005d' },
    dark: { primary: '#d0bcff', primaryHover: '#e8def8', onPrimary: '#381e72', primaryContainer: '#4f378b', onPrimaryContainer: '#eaddff', headerBg: '#4f378b', nodeBg: '#4f378b', nodeBorder: '#d0bcff', nodeText: '#eaddff' },
  },
  blue: {
    light: { primary: '#0061a4', primaryHover: '#1a73b8', onPrimary: '#ffffff', primaryContainer: '#d1e4ff', onPrimaryContainer: '#001d36', headerBg: '#0061a4', nodeBg: '#d1e4ff', nodeBorder: '#0061a4', nodeText: '#001d36' },
    dark: { primary: '#9fcaff', primaryHover: '#bbdaff', onPrimary: '#003258', primaryContainer: '#00497d', onPrimaryContainer: '#d1e4ff', headerBg: '#00497d', nodeBg: '#00497d', nodeBorder: '#9fcaff', nodeText: '#d1e4ff' },
  },
  green: {
    light: { primary: '#3d6b32', primaryHover: '#2e5426', onPrimary: '#ffffff', primaryContainer: '#bef0ac', onPrimaryContainer: '#072100', headerBg: '#3d6b32', nodeBg: '#bef0ac', nodeBorder: '#3d6b32', nodeText: '#072100' },
    dark: { primary: '#a2d48e', primaryHover: '#b7dea3', onPrimary: '#133a0a', primaryContainer: '#2a5223', onPrimaryContainer: '#bef0ac', headerBg: '#2a5223', nodeBg: '#2a5223', nodeBorder: '#a2d48e', nodeText: '#bef0ac' },
  },
  peach: {
    light: { primary: '#8b5000', primaryHover: '#764300', onPrimary: '#ffffff', primaryContainer: '#ffdcbe', onPrimaryContainer: '#2c1600', headerBg: '#8b5000', nodeBg: '#ffdcbe', nodeBorder: '#8b5000', nodeText: '#2c1600' },
    dark: { primary: '#ffb874', primaryHover: '#ffc793', onPrimary: '#4a2800', primaryContainer: '#6b3d00', onPrimaryContainer: '#ffdcbe', headerBg: '#6b3d00', nodeBg: '#6b3d00', nodeBorder: '#ffb874', nodeText: '#ffdcbe' },
  },
  rose: {
    light: { primary: '#9c4057', primaryHover: '#833449', onPrimary: '#ffffff', primaryContainer: '#ffd9e2', onPrimaryContainer: '#3e001d', headerBg: '#9c4057', nodeBg: '#ffd9e2', nodeBorder: '#9c4057', nodeText: '#3e001d' },
    dark: { primary: '#ffb1c8', primaryHover: '#ffc1d3', onPrimary: '#5e1132', primaryContainer: '#7c2947', onPrimaryContainer: '#ffd9e2', headerBg: '#7c2947', nodeBg: '#7c2947', nodeBorder: '#ffb1c8', nodeText: '#ffd9e2' },
  },
  teal: {
    light: { primary: '#006a60', primaryHover: '#00554d', onPrimary: '#ffffff', primaryContainer: '#74f8e5', onPrimaryContainer: '#00201c', headerBg: '#006a60', nodeBg: '#74f8e5', nodeBorder: '#006a60', nodeText: '#00201c' },
    dark: { primary: '#52dbc9', primaryHover: '#7ee6d8', onPrimary: '#003731', primaryContainer: '#004f47', onPrimaryContainer: '#74f8e5', headerBg: '#004f47', nodeBg: '#004f47', nodeBorder: '#52dbc9', nodeText: '#74f8e5' },
  },
};

const PALETTE_COLORS: Record<ThemeStyleId, Record<string, Record<ThemeModeId, PaletteColorSet>>> = {
  ea: EA_PALETTE_COLORS,
  m3: M3_PALETTE_COLORS,
};

export function getPaletteColors(style: ThemeStyleId, palette: PaletteId, mode: ThemeModeId): PaletteColorSet {
  return PALETTE_COLORS[style][palette]?.[mode] ?? PALETTE_COLORS[style][DEFAULT_PALETTE[style]][mode];
}

// Canvas colors that are neutral/semantic and stay the same across every palette within a style -
// edge lines, the junction dot, the canvas background dots, and the always-red "conflict" color -
// so the meaning of those colors ("gray = normal flow", "red = conflicting master") doesn't shift
// depending on which accent palette is active.
export type NeutralCanvasTokens = {
  junctionColor: string;
  edgeColor: string;
  edgeConflictColor: string;
  canvasDotColor: string;
  criticalDotColor: string;
  labelBg: string;
};

const NEUTRAL_CANVAS_TOKENS: Record<ThemeId, NeutralCanvasTokens> = {
  'ea-light': {
    junctionColor: '#94a3b8',
    edgeColor: '#94a3b8',
    edgeConflictColor: '#dc2626',
    canvasDotColor: '#cbd5e1',
    criticalDotColor: '#ef4444',
    labelBg: '#ffffff',
  },
  'ea-dark': {
    junctionColor: '#64748b',
    edgeColor: '#64748b',
    edgeConflictColor: '#f87171',
    canvasDotColor: '#334155',
    criticalDotColor: '#f87171',
    labelBg: '#1e293b',
  },
  'm3-light': {
    junctionColor: '#79747e',
    edgeColor: '#79747e',
    edgeConflictColor: '#b3261e',
    canvasDotColor: '#e7e0ec',
    criticalDotColor: '#b3261e',
    labelBg: '#ffffff',
  },
  'm3-dark': {
    junctionColor: '#938f99',
    edgeColor: '#938f99',
    edgeConflictColor: '#f2b8b5',
    canvasDotColor: '#49454f',
    criticalDotColor: '#f2b8b5',
    labelBg: '#211f26',
  },
};

export type CanvasTokens = NeutralCanvasTokens & {
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
};

export function getCanvasTokens(style: ThemeStyleId, palette: PaletteId, mode: ThemeModeId): CanvasTokens {
  const themeId: ThemeId = `${style}-${mode}`;
  const paletteColors = getPaletteColors(style, palette, mode);
  return {
    ...NEUTRAL_CANVAS_TOKENS[themeId],
    nodeBg: paletteColors.nodeBg,
    nodeBorder: paletteColors.nodeBorder,
    nodeText: paletteColors.nodeText,
  };
}

export const isThemeId = (value: string): value is ThemeId =>
  value === 'ea-light' || value === 'ea-dark' || value === 'm3-light' || value === 'm3-dark';
