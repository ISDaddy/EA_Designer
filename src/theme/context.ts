import { createContext } from 'react';
import type { ThemeStyleId, ThemeModeId, ThemeId, PaletteId, PaletteDef, CanvasTokens } from './tokens';

export type ThemeContextValue = {
  style: ThemeStyleId;
  mode: ThemeModeId;
  palette: PaletteId;
  themeId: ThemeId;
  tokens: CanvasTokens;
  palettesForStyle: PaletteDef[];
  setStyle: (style: ThemeStyleId) => void;
  setMode: (mode: ThemeModeId) => void;
  setPalette: (palette: PaletteId) => void;
  toggleMode: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);
