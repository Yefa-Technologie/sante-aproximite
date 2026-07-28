import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const TOKEN_KEY = "sante_aproxmite_token";
const REFRESH_TOKEN_KEY = "sante_aproxmite_refresh_token";
const USER_KEY = "sante_aproxmite_user";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function hydrate() {
      try {
        const [storedToken, storedRefreshToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(REFRESH_TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY)
        ]);

        if (storedToken) setToken(storedToken);
        if (storedRefreshToken) setRefreshToken(storedRefreshToken);
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser && typeof parsedUser === "object" ? parsedUser : null);
          } catch {
            await AsyncStorage.removeItem(USER_KEY);
            setUser(null);
          }
        }
      } finally {
        setReady(true);
      }
    }

    hydrate().catch(async () => {
      await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY]);
      setToken("");
      setRefreshToken("");
      setUser(null);
      setReady(true);
    });
  }, []);

  const login = async (payload) => {
    const safeToken = String(payload?.token || "");
    const safeRefreshToken = String(payload?.refreshToken || "");
    const safeUser = payload?.user && typeof payload.user === "object" ? payload.user : null;
    setToken(safeToken);
    setRefreshToken(safeRefreshToken);
    setUser(safeUser);
    await AsyncStorage.multiSet([
      [TOKEN_KEY, safeToken],
      [REFRESH_TOKEN_KEY, safeRefreshToken],
      [USER_KEY, JSON.stringify(safeUser)]
    ]);
  };

  const logout = async () => {
    setToken("");
    setRefreshToken("");
    setUser(null);
    await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY]);
  };

  const value = useMemo(() => ({ token, refreshToken, user, ready, login, logout }), [token, refreshToken, user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth doit etre utilise dans AuthProvider");
  }
  return ctx;
}
