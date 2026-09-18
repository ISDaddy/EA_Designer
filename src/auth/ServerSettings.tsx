import { EmailSettings } from './EmailSettings';
import { GoogleSignInSettings } from './GoogleSignInSettings';

// Server-wide configuration (the Gmail SMTP sender, Google Sign-In's Client ID) - visible only to
// a Super Admin, unlike the rest of Settings' admin-visible tabs. Kept separate from those since
// these two change how the whole app authenticates everyone, not just this workspace's data.
export function ServerSettings() {
  return (
    <div className="flex flex-col gap-4">
      <EmailSettings />
      <GoogleSignInSettings />
    </div>
  );
}
