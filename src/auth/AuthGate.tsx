import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './useAuth';
import { LoginView } from './LoginView';
import { AcceptInviteView } from './AcceptInviteView';
import { FullScreenLoader } from './AuthShell';

// Decides which of the three top-level screens to render: an invite acceptance flow (present
// regardless of current login state, so an invite link works even if some other account is
// mid-session on this browser), the login/first-run-setup screen, or the real app.
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));

  const clearInviteParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.toString());
    setInviteToken(null);
  };

  if (inviteToken) {
    return <AcceptInviteView token={inviteToken} onDone={clearInviteParam} />;
  }

  if (loading) return <FullScreenLoader />;

  if (!user) return <LoginView />;

  return <>{children}</>;
}
