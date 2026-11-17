import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AppRole, Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setRole(null);
      return;
    }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    setProfile(p as Profile | null);
    if (p?.role_id) {
      const { data: r } = await supabase.from('app_roles').select('*').eq('id', p.role_id).maybeSingle();
      setRole(r as AppRole | null);
    } else {
      setRole(null);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(async () => {
          const pw = window.prompt('Enter a new password (min 8 characters)');
          if (pw && pw.length >= 8) {
            const { error } = await supabase.auth.updateUser({ password: pw });
            window.alert(error ? error.message : 'Password updated.');
          }
        }, 0);
      }
      // Defer DB calls out of the auth callback to avoid supabase-js deadlocks
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const can = useCallback(
    (perm: string) => !!role && (role.permissions.includes('admin') || role.permissions.includes(perm)),
    [role],
  );

  const value: AuthState = {
    session,
    profile,
    role,
    loading,
    can,
    refresh: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
