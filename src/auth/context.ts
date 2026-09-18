import { createContext } from 'react';
import type { ApiUser } from '../api';

// login() resolves to this instead of logging the person in directly when their account has 2FA
// enabled - LoginView switches to a code-entry step and finishes the job with verifyTotp().
export type LoginResult = { requiresTotp: false } | { requiresTotp: true; challengeToken: string };

export type AuthContextValue = {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginWithGoogle: (credential: string) => Promise<LoginResult>;
  verifyTotp: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
