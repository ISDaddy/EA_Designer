import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch, parseJsonOrError } from '../api';
import type { ApiUser } from '../api';
import { useAuth } from './useAuth';
import { LogoMark } from '../LogoMark';
import { FullScreenLoader } from './AuthShell';
import { cardClass, buttonPrimaryClass, buttonSecondaryClass } from '../ui';

type NdaContent = { version: string; title: string; text: string };

// POC-phase gate: sits inside AuthGate (so it only ever runs for an already-authenticated user)
// and blocks everything else in the app until the signed-in user has accepted the current version
// of the NDA in server/nda.js. Bumping that file's `version` re-prompts everyone, even users who
// accepted an earlier wording.
export function NdaGate({ children }: { children: ReactNode }) {
  const { user, setUser, logout } = useAuth();
  const [nda, setNda] = useState<NdaContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/legal/nda');
        const data = (await parseJsonOrError(res)) as NdaContent;
        if (!cancelled) setNda(data);
      } catch {
        // best-effort - if this fails, the gate below just keeps showing its own loading state
        // rather than letting anyone through unverified
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!user) return <>{children}</>;
  if (loading) return <FullScreenLoader />;
  if (!nda || user.ndaAcceptedVersion === nda.version) return <>{children}</>;

  const accept = async () => {
    if (!agreed) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/legal/accept-nda', { method: 'POST' });
      const updated = (await parseJsonOrError(res)) as ApiUser;
      setUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record your acceptance.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-app)', fontFamily: 'var(--font-sans)' }}>
      <div className={`${cardClass} w-full max-w-xl p-6 flex flex-col gap-4`}>
        <div className="flex items-center gap-2" style={{ color: 'var(--primary)' }}>
          <LogoMark size={24} />
          <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>EA Designer</span>
        </div>

        <div>
          <h1 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ShieldCheck size={18} style={{ color: 'var(--primary)' }} />
            {nda.title}
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Signed in as {user.name || user.email}. You must accept this agreement before continuing.
          </p>
        </div>

        <div
          className="text-sm whitespace-pre-wrap overflow-y-auto p-3 rounded-[var(--radius-input)] border"
          style={{ maxHeight: '45vh', color: 'var(--text-secondary)', background: 'var(--bg-surface-alt)', borderColor: 'var(--border-subtle)' }}
        >
          {nda.text}
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read and agree to this Confidentiality &amp; Non-Disclosure Agreement.
        </label>

        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button className={buttonSecondaryClass} onClick={() => logout()}>Log out instead</button>
          <button className={buttonPrimaryClass} disabled={!agreed || submitting} onClick={accept}>
            {submitting ? 'Saving...' : 'I agree'}
          </button>
        </div>
      </div>
    </div>
  );
}
