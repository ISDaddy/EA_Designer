import { Check, Moon, Sun } from 'lucide-react';
import { useTheme } from './useTheme';
import { THEME_STYLES } from './tokens';
import { useI18n } from '../i18n/useI18n';

// Personal preference, available to every signed-in user (not just admins) - lives on the Profile
// page rather than the shared Settings page for the same reason Language & Region does. Saved to
// the signed-in account (see ThemeContext.tsx), so it follows a person to another device.
export function AppearanceSettings() {
  const { style, mode, palette, palettesForStyle, setStyle, setMode, setPalette } = useTheme();
  const { t } = useI18n();

  return (
    <section
      className="p-5 flex flex-col gap-6"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>{t('settings.appearance')}</h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('settings.appearanceBlurb')}
        </p>
      </div>

      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('settings.visualStyle')}</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {THEME_STYLES.map(s => {
            const isActive = style === s.id;
            return (
              <button
                key={s.id}
                aria-pressed={isActive}
                className="flex items-start gap-3 p-4 text-left transition-colors"
                style={{
                  borderRadius: 'var(--radius-card)',
                  border: `1.5px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                  background: isActive ? 'var(--primary-container)' : 'var(--bg-surface)',
                  color: isActive ? 'var(--on-primary-container)' : 'var(--text-primary)',
                }}
                onClick={() => setStyle(s.id)}
              >
                <span
                  className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: isActive ? 'var(--primary)' : 'transparent', border: isActive ? 'none' : '1.5px solid var(--border-strong)' }}
                >
                  {isActive && <Check size={13} color="var(--on-primary)" strokeWidth={3} />}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs mt-0.5 opacity-80">{s.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('settings.colorPalette')}</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {palettesForStyle.map(p => {
            const isActive = p.id === palette;
            return (
              <button
                key={p.id}
                aria-pressed={isActive}
                className="flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors"
                style={{
                  borderRadius: 'var(--radius-input)',
                  color: 'var(--text-primary)',
                  background: isActive ? 'var(--bg-surface-alt)' : 'transparent',
                  boxShadow: isActive ? `inset 0 0 0 1.5px ${p.swatch}` : 'inset 0 0 0 1px var(--border-subtle)',
                }}
                onClick={() => setPalette(p.id)}
              >
                <span
                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                  style={{ background: p.swatch }}
                >
                  {isActive && <Check size={12} color="#fff" strokeWidth={3} />}
                </span>
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('settings.mode')}</span>
        <div className="inline-flex gap-1 p-1" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
          <button
            aria-pressed={mode === 'light'}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
            style={mode === 'light' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
            onClick={() => setMode('light')}
          >
            <Sun size={14} />{t('settings.light')}
          </button>
          <button
            aria-pressed={mode === 'dark'}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
            style={mode === 'dark' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
            onClick={() => setMode('dark')}
          >
            <Moon size={14} />{t('settings.dark')}
          </button>
        </div>
      </div>
    </section>
  );
}
