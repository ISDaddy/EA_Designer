import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './useAuth';
import { LoginView } from './LoginView';
import { AcceptInviteView } from './AcceptInviteView';
import { ResetPasswordView } from './ResetPasswordView';
import { FullScreenLoader } from './AuthShell';

// Decides which of the top-level screens to render: an invite acceptance or password-reset flow
// (present regardless of current login state, so a link works even if some other account is
// mid-session on this browser), the login/first-run-setup screen, or the real app.
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));

  const clearParam = (name: string, clear: () => void) => {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState({}, '', url.toString());
    clear();
  };
  const clearInviteParam = () => clearParam('invite', () => setInviteToken(null));
  const clearResetParam = () => clearParam('reset', () => setResetToken(null));

  if (inviteToken) {
    return <AcceptInviteView token={inviteToken} onDone={clearInviteParam} />;
  }

  if (resetToken) {
    return <ResetPasswordView token={resetToken} onDone={clearResetParam} />;
  }

  if (loading) return <FullScreenLoader />;

  if (!user) return <LoginView />;

  return <>{children}</>;
}
