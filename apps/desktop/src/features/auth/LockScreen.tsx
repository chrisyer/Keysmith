import { ArrowRight, Fingerprint, Globe, KeyRound, Loader2, Lock, LogOut, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORTED_LOCALES, useI18n, type LanguageMode } from '../../i18n';
import { isTauriRuntime, tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

export function LockScreen() {
  const inTauri = isTauriRuntime();
  const { dict, languageMode, setLanguageMode, fmt } = useI18n();

  const accountId = useSessionStore((s) => s.accountId);
  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const savedAccounts = useSessionStore((s) => s.savedAccounts);
  const unlockWithPassword = useSessionStore((s) => s.unlockWithPassword);
  const unlockWithBiometric = useSessionStore((s) => s.unlockWithBiometric);
  const loginWithPasskey = useSessionStore((s) => s.loginWithPasskey);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const startAddingAccount = useSessionStore((s) => s.startAddingAccount);
  const logout = useSessionStore((s) => s.logout);

  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [touchScanning, setTouchScanning] = useState(false);
  const [passkeyScanning, setPasskeyScanning] = useState(false);
  const [hasAccountPasskeys, setHasAccountPasskeys] = useState(!inTauri);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const hasAutoPromptedRef = useRef(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void tauriClient
      .accountPasskeyList()
      .then((res) => {
        setHasAccountPasskeys(res.credentials.length > 0);
      })
      .catch(() => {
        setHasAccountPasskeys(false);
      });
  }, [accountId]);

  const triggerShake = () => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  };

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setUnlocking(true);
    setError(null);
    try {
      await unlockWithPassword(password);
      await refreshAll(getFilter());
    } catch (err) {
      setPassword('');
      setError(err instanceof Error ? err.message : 'Incorrect master password');
      triggerShake();
    } finally {
      setUnlocking(false);
    }
  };

  const handleTouchId = useCallback(
    async (isAuto = false) => {
      setTouchScanning(true);
      setError(null);
      try {
        await unlockWithBiometric();
        await refreshAll(getFilter());
      } catch (err) {
        if (isAuto) {
          setError(dict.lock.biometricFailedFallback);
        } else {
          setError(err instanceof Error ? err.message : 'Touch ID failed');
        }
        window.setTimeout(() => passwordInputRef.current?.focus(), 60);
      } finally {
        setTouchScanning(false);
      }
    },
    [dict.lock.biometricFailedFallback, getFilter, refreshAll, unlockWithBiometric],
  );

  const handlePasskeyUnlock = async () => {
    setPasskeyScanning(true);
    setError(null);
    try {
      await loginWithPasskey();
      await refreshAll(getFilter());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey unlock failed');
      window.setTimeout(() => passwordInputRef.current?.focus(), 60);
    } finally {
      setPasskeyScanning(false);
    }
  };

  useEffect(() => {
    if (!inTauri || !biometricEnabled || hasAutoPromptedRef.current) return;

    const triggerOnce = () => {
      if (hasAutoPromptedRef.current) return;
      hasAutoPromptedRef.current = true;
      void handleTouchId(true);
    };

    if (document.visibilityState === 'visible' && document.hasFocus()) {
      const timer = window.setTimeout(triggerOnce, 220);
      return () => window.clearTimeout(timer);
    }

    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      triggerOnce();
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [inTauri, biometricEnabled, handleTouchId]);

  const initials = (displayName || email || 'K').slice(0, 2).toUpperCase();
  const hasQuickUnlock = biometricEnabled || hasAccountPasskeys;

  return (
    <div className="h-dvh w-full flex flex-col items-center justify-center bg-[var(--bg-sidebar)] p-6">
      {inTauri && <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-9" />}
      <div className="relative w-full max-w-[360px] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-xl p-7 flex flex-col items-center text-center">
        <label className="absolute top-3.5 right-3.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[10.5px] font-medium text-[var(--text-secondary)] cursor-pointer">
          <Globe size={11} />
          <select
            aria-label={dict.settings.languageLabel}
            value={languageMode}
            onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
            className="bg-transparent focus:outline-none cursor-pointer text-[10.5px] font-medium text-[var(--text-secondary)]"
          >
            <option value="system">{dict.settings.languageSystem}</option>
            {SUPPORTED_LOCALES.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <div className="w-14 h-14 rounded-full bg-[var(--accent-primary)] text-white text-lg font-semibold flex items-center justify-center">
            {initials}
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)]">
            <Lock size={11} />
          </div>
        </div>

        <h1 className="mt-3.5 text-[15px] font-semibold text-[var(--text-primary)]">{displayName || email}</h1>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{email}</p>
        {serverUrl && (
          <p className="mt-1 text-[11px] font-mono-tabular text-[var(--text-muted)] truncate max-w-full">
            {serverUrl}
          </p>
        )}

        {savedAccounts.length > 1 && (
          <div className="mt-3 w-full">
            <select
              aria-label={dict.lock.switchAccount}
              value={accountId}
              onChange={(e) => {
                if (e.target.value !== accountId) {
                  setPassword('');
                  setError(null);
                  void switchAccount(e.target.value);
                }
              }}
              className="ks-select w-full"
            >
              {savedAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.email} ({acc.serverUrl})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Default Primary Unlock: Touch ID & Passkey / Hello Key */}
        {biometricEnabled && (
          <button
            type="button"
            onClick={() => void handleTouchId(false)}
            disabled={touchScanning}
            className="mt-5 w-full py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-70 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {touchScanning ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Fingerprint size={16} />
            )}
            {touchScanning ? dict.lock.touchIdVerifying : dict.lock.touchIdBtn}
          </button>
        )}

        {hasAccountPasskeys && (
          <button
            type="button"
            onClick={() => void handlePasskeyUnlock()}
            disabled={passkeyScanning}
            className={`${biometricEnabled ? 'mt-2' : 'mt-5'} w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              biometricEnabled
                ? 'bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[var(--text-primary)]'
                : 'bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white font-semibold py-2.5'
            }`}
          >
            <KeyRound
              size={14}
              className={
                passkeyScanning
                  ? 'animate-pulse'
                  : biometricEnabled
                    ? 'text-[var(--accent-primary)]'
                    : 'text-white'
              }
            />
            {passkeyScanning ? dict.lock.passkeyVerifying : dict.lock.passkeyBtn}
          </button>
        )}

        {hasQuickUnlock && (
          <div className="w-full flex items-center gap-2.5 mt-4 mb-2">
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-[10.5px] text-[var(--text-muted)]">{dict.lock.orMasterPassword}</span>
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>
        )}

        {/* Master Password Fallback */}
        <form
          onSubmit={(e) => void handlePasswordUnlock(e)}
          className={`w-full ${hasQuickUnlock ? 'mt-0.5' : 'mt-5'} flex flex-col gap-2`}
        >
          <div className={`relative flex items-center ${shaking ? 'ks-shake' : ''}`}>
            <input
              ref={passwordInputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={!hasQuickUnlock}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={
                inTauri
                  ? dict.lock.unlockPlaceholder
                  : fmt(dict.lock.demoUnlockPlaceholder, { pw: 'keysmith' })
              }
              aria-label={dict.auth.masterPassword}
              className="w-full pl-3 pr-10 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={unlocking || !password}
              aria-label={dict.lock.unlockBtn}
              className="absolute right-1.5 p-1.5 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
            >
              {unlocking ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            </button>
          </div>

          {error && (
            <p className="text-[11px] text-[var(--status-danger)] text-left px-0.5">{error}</p>
          )}
        </form>

        <div className="mt-5 pt-3.5 border-t border-[var(--border-subtle)] w-full flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <button
            type="button"
            onClick={startAddingAccount}
            className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline cursor-pointer"
          >
            <UserPlus size={12} />
            {dict.lock.addAccount}
          </button>

          {confirmRemove ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {dict.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRemove(false);
                  void logout(false);
                }}
                className="text-[var(--status-danger)] font-medium cursor-pointer"
              >
                {dict.common.confirm}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--status-danger)] cursor-pointer"
            >
              <LogOut size={12} />
              {dict.lock.removeAccount}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
