import { useEffect, useRef } from 'react';

// Only the shape of the Google Identity Services API this component actually calls - the real
// library attaches a much larger `google` global, but declaring more than this would just be
// documenting an API we don't use.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const SCRIPT_ID = 'google-identity-services';

// Loaded lazily (only when the login screen actually renders a Google button) rather than in
// index.html, so an already-signed-in visit never fetches Google's script at all. Cached as a
// module-level promise so switching between login/setup/forgot modes doesn't reload it.
let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (document.getElementById(SCRIPT_ID)) { resolve(); return; }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function GoogleSignInButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(containerRef.current, { theme: 'outline', size: 'large', width: 300 });
      })
      .catch(() => {
        // The rest of the login form still works without Google - a network hiccup fetching
        // Google's script just means the button silently doesn't appear.
      });
    return () => { cancelled = true; };
  }, [clientId, onCredential]);

  return <div ref={containerRef} />;
}
