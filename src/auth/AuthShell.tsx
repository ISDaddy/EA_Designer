import type { ReactNode } from 'react';
import { LogoMark } from '../LogoMark';
import { cardClass } from '../ui';

// The centered card shell shared by the login/setup screen and the accept-invite screen - the
// only two places the app renders full-page instead of the normal header+content layout.
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="w-full h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-app)', fontFamily: 'var(--font-sans)' }}>
      <div className={`${cardClass} w-full max-w-sm p-6 flex flex-col gap-4`}>
        <div className="flex items-center gap-2 justify-center" style={{ color: 'var(--primary)' }}>
          <LogoMark size={26} />
          <span className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>EA Designer</span>
        </div>
        <div className="text-center">
          <h1 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{title}</h1>
          {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="w-full h-screen flex items-center justify-center" style={{ background: 'var(--bg-app)' }}>
      <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
    </div>
  );
}
