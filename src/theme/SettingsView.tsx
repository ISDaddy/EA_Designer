import { Check, Moon, Sun } from 'lucide-react';
import { useTheme } from './useTheme';
import { THEME_STYLES } from './tokens';

export function SettingsView() {
  const { style, mode, palette, palettesForStyle, setStyle, setMode, setPalette } = useTheme();

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-canvas)' }}>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <h2 className="text-lg font-bold tracking-[var(--heading-tracking)]" style={{ color: 'var(--text-primary)' }}>Settings</h2>

        <section
          className="p-5 flex flex-col gap-6"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--text-primary)' }}>Appearance</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Choose the visual style, an accent color palette, and light or dark mode. Your choices are saved on this device.
            </p>
          </div>

          <div>
            <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Visual style</span>
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
            <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Color palette</span>
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
            <span className="block text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Mode</span>
            <div className="inline-flex gap-1 p-1" style={{ background: 'var(--bg-surface-alt)', borderRadius: 'var(--radius-card)' }}>
              <button
                aria-pressed={mode === 'light'}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={mode === 'light' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => setMode('light')}
              >
                <Sun size={14} />Light
              </button>
              <button
                aria-pressed={mode === 'dark'}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] transition-colors"
                style={mode === 'dark' ? { background: 'var(--bg-surface)', color: 'var(--primary)', boxShadow: 'var(--shadow-sm)' } : { color: 'var(--text-secondary)' }}
                onClick={() => setMode('dark')}
              >
                <Moon size={14} />Dark
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
