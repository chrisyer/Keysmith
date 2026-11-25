import { create } from 'zustand';
import { tauriClient } from '../services/tauriClient';
import type { AuthStatus, SessionState } from '../types/domain';

interface SessionStore extends SessionState {
  initialized: boolean;
  init: () => Promise<void>;
  setAuthStatus: (status: AuthStatus) => void;
  login: (params: { serverUrl: string; email: string; masterPassword: string }) => Promise<void>;
  loginWithPasskey: (credentialId?: string) => Promise<void>;
  register: (params: { serverUrl: string; email: string; name: string; masterPassword: string }) => Promise<void>;
  logout: (clearLocalCache?: boolean) => Promise<void>;
  unlockWithPassword: (masterPassword: string) => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  lock: (reason?: string) => Promise<void>;
  updateProfile: (displayName: string) => Promise<{ rpId: string; userId: string; name: string; displayName: string }>;
  updatePreferences: (
    patch: Partial<Pick<SessionState, 'biometricEnabled' | 'autoLockMinutes' | 'clipboardClearSeconds'>>,
  ) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set) => ({
  initialized: false,
  status: 'Unlocked',
  email: 'cherry@example.com',
  displayName: 'Cherry Wang',
  serverUrl: 'http://localhost:8080',
  biometricEnabled: true,
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  lastSyncAt: new Date().toISOString(),
  kdfType: 'Argon2id',

  init: async () => {
    const state = await tauriClient.sessionGetState();
    set({ ...state, initialized: true });
  },

  setAuthStatus: (status) => set({ status }),

  login: async (params) => {
    const next = await tauriClient.authLogin(params);
    set({ ...next });
  },

  loginWithPasskey: async (credentialId) => {
    const next = await tauriClient.authPasskeyLogin(credentialId);
    set({ ...next });
  },

  register: async (params) => {
    const next = await tauriClient.authRegister(params);
    set({ ...next });
  },

  logout: async (clearLocalCache = false) => {
    await tauriClient.authLogout(clearLocalCache);
    set({ status: 'Unauthenticated' });
  },

  unlockWithPassword: async (masterPassword) => {
    const next = await tauriClient.sessionUnlockPassword(masterPassword);
    set({ ...next });
  },

  unlockWithBiometric: async () => {
    const next = await tauriClient.sessionUnlockBiometric();
    set({ ...next });
  },

  lock: async (reason = 'manual') => {
    await tauriClient.sessionLock(reason);
    set({ status: 'Locked' });
  },

  updateProfile: async (displayName) => {
    const res = await tauriClient.accountUpdateProfile(displayName);
    set({ displayName: res.displayName });
    return res;
  },

  updatePreferences: async (patch) => {
    const next = await tauriClient.sessionUpdatePreferences(patch);
    set({ ...next });
  },
}));
