import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, login, setToken } from './api';
import { unsubscribePush } from './push';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [authError, setAuthError] = useState('');

  const clear = useCallback(() => {
    setUser(null);
    setProfile(null);
    setProfiles([]);
  }, []);

  const hydrate = useCallback(async () => {
    const me = await api.get('/me');
    setProfile(me);
    setProfiles(await api.get('/profiles'));
    setUser(me);
  }, []);

  // Al abrir la app: si hay un token guardado, intenta retomar la sesión
  useEffect(() => {
    if (!getToken()) {
      clear();
    } else {
      hydrate().catch((e) => {
        setAuthError(e.message);
        clear();
      });
    }
    window.addEventListener('uscial:unauthorized', clear);
    return () => window.removeEventListener('uscial:unauthorized', clear);
  }, [hydrate, clear]);

  const signIn = useCallback(
    async (email, password) => {
      setAuthError('');
      await login(email, password);
      await hydrate();
    },
    [hydrate]
  );

  const signOut = useCallback(async () => {
    await unsubscribePush().catch(() => {}); // antes de borrar el token, para poder avisar al servidor
    setToken(null);
    clear();
  }, [clear]);

  // Tema: se guarda en el perfil y se recuerda en el dispositivo
  useEffect(() => {
    const theme = profile?.theme || localStorage.getItem('theme') || 'light';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [profile?.theme]);

  const refreshProfiles = useCallback(async () => setProfiles(await api.get('/profiles')), []);

  const updateProfile = useCallback(
    async (patch) => {
      setProfile(await api.patch('/me', patch));
      refreshProfiles();
    },
    [refreshProfiles]
  );

  const setAvatar = useCallback(
    async (file) => {
      const form = new FormData();
      form.append('file', file);
      setProfile(await api.upload('/me/avatar', form));
      refreshProfiles();
    },
    [refreshProfiles]
  );

  const getPerson = useCallback(
    (uid) => profiles.find((p) => p.uid === uid) || { uid, username: 'Tu pareja', avatar_media_id: null },
    [profiles]
  );

  const value = useMemo(
    () => ({ user, profile, profiles, authError, signIn, signOut, updateProfile, setAvatar, getPerson }),
    [user, profile, profiles, authError, signIn, signOut, updateProfile, setAvatar, getPerson]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
