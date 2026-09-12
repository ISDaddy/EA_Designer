import { createContext } from 'react';
import type { ApiUser } from '../api';

export type AuthContextValue = {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
