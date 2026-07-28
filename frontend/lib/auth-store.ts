"use client";

import { create } from "zustand";
import { TOKEN_KEY, USER_KEY } from "./api-client";
import type { User } from "./roles";

type LoginPayload = {
  token: string;
  user: User & { permissions?: string[] };
};

type AuthState = {
  token: string;
  user: User | null;
  ready: boolean;
  hydrate: () => void;
  login: (payload: LoginPayload) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: "",
  user: null,
  ready: false,
  hydrate: () => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as User) : null;
    set({ token, user, ready: true });
  },
  login: (payload) => {
    const user: User = { ...payload.user, permissions: payload.user.permissions || [] };
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token: payload.token, user, ready: true });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: "", user: null, ready: true });
  },
}));
