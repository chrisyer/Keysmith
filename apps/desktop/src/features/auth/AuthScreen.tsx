import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Globe, KeyRound, Loader2, Server } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  isCustomWindowChrome,
  useWindowMaximized,
  WindowControls,
  WindowResizeHandles,
} from '../../components/WindowChrome';
import { SUPPORTED_LOCALES, useI18n, type LanguageMode } from '../../i18n';
import { evaluatePasswordStrength } from '../../services/generator';
import { isTauriRuntime, KeysmithIpcError, tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

function isNonLoopbackHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^http:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]';
  } catch {
    return true;
  }
}

function meetsRegistrationPasswordFloor(pw: string): boolean {
  if (pw.length < 12) return false;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes += 1;
  if (/[A-Z]/.test(pw)) classes += 1;
  if (/\d/.test(pw)) classes += 1;
  if (/[^A-Za-z0-9]/.test(pw)) classes += 1;
  return classes >= 2;
}

export function AuthScreen() {
  const inTauri = isTauriRuntime();
  const customChrome = isCustomWindowChrome();
  const isMaximized = useWindowMaximized();
  const { dict, languageMode, setLanguageMode, fmt } = useI18n();

  const addingAccount = useSessionStore((s) => s.addingAccount);
  const savedAccounts = useSessionStore((s) => s.savedAccounts);
  const appSettings = useSessionStore((s) => s.appSettings);
  const cancelAddingAccount = useSessionStore((s) => s.cancelAddingAccount);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const login = useSessionStore((s) => s.login);
  const register = useSessionStore((s) => s.register);
  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  const useDevPreviewDefaults = import.meta.env.DEV && !inTauri;
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState(
    inTauri ? appSettings.lastServerUrl ?? '' : useDevPreviewDefaults ? 'http://localhost:8080' : '',
  );
  const [serverOk, setServerOk] = useState<'idle' | 'checking' | 'ok' | 'error'>(
    useDevPreviewDefaults ? 'ok' : 'idle',
  );
  const [serverVersion, setServerVersion] = useState(
    useDevPreviewDefaults ? 'Vaultwarden 1.32.5 (Local)' : '',
  );
  const [registrationDisabled, setRegistrationDisabled] = useState(false);
  const [email, setEmail] = useState(useDevPreviewDefaults ? 'cherry@example.com' : '');
  const [name, setName] = useState(useDevPreviewDefaults ? 'Cherry Wang' : '');
  const [masterPassword, setMasterPassword] = useState(useDevPreviewDefaults ? 'keysmith' : '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorVisible, setTwoFactorVisible] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);
  const [weakKdfMessage, setWeakKdfMessage] = useState<string | null>(null);

  const nonLoopbackHttp = isNonLoopbackHttpUrl(serverUrl);

  const canCancelBack = addingAccount || savedAccounts.length > 0;

  useEffect(() => {
    if (inTauri && !serverUrl && appSettings.lastServerUrl) {
      setServerUrl(appSettings.lastServerUrl);
    }
  }, [inTauri, appSettings.lastServerUrl, serverUrl]);

  useEffect(() => {
    if (!addingAccount) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelAddingAccount();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addingAccount, cancelAddingAccount]);

  const checkServer = useCallback(
    async (targetUrl = serverUrl, allowHttp = allowInsecureHttp) => {
      const cleanUrl = targetUrl.trim();
      if (!cleanUrl) return;
      if (isNonLoopbackHttpUrl(cleanUrl) && !allowHttp) {
        setServerOk('idle');
        setServerVersion('');
        return;
      }
      setServerOk('checking');
      try {
        const res = await tauriClient.authCheckServer(cleanUrl, allowHttp);
        setServerOk(res.ok ? 'ok' : 'error');
        setServerVersion(res.version);
        const disabled = Boolean(res.disableUserRegistration);
        setRegistrationDisabled(disabled);
        if (disabled) {
          setTab('login');
        }
      } catch {
        setServerOk('error');
        setServerVersion('');
      }
    },
    [serverUrl, allowInsecureHttp],
  );

  const evaluateWeakKdf = (cfg: {
    kdf: number;
    kdfIterations: number;
    kdfMemory?: number | null;
  }): string | null => {
    if (cfg.kdf === 0 && cfg.kdfIterations < 600_000) {
      return fmt(dict.auth.weakKdfWarning, { iterations: cfg.kdfIterations });
    }
    if (cfg.kdf === 1) {
      const iters = cfg.kdfIterations ?? 0;
      const mem = cfg.kdfMemory ?? 0;
      if (iters < 3 || mem < 64) {
        return fmt(dict.auth.weakArgon2Warning, { iterations: iters, memory: mem });
      }
    }
    return null;
  };

  const probePrelogin = async () => {
    const cleanServer = serverUrl.trim();
    const cleanEmail = email.trim();
    if (!cleanServer || !cleanEmail || !cleanEmail.includes('@')) return;
    if (isNonLoopbackHttpUrl(cleanServer) && !allowInsecureHttp) return;
    try {
      const cfg = await tauriClient.authPrelogin(cleanServer, cleanEmail, allowInsecureHttp);
      setWeakKdfMessage(evaluateWeakKdf(cfg));
    } catch {
      // Silent on blur; handleSubmit surfaces errors
    }
  };

  const strength = evaluatePasswordStrength(masterPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (nonLoopbackHttp && !allowInsecureHttp) {
      setError(dict.auth.insecureHttpRequired);
      return;
    }
    if (tab === 'register') {
      if (!meetsRegistrationPasswordFloor(masterPassword)) {
        setError(dict.auth.masterPasswordTooWeak);
        return;
      }
      if (masterPassword !== confirmPassword) {
        setError(dict.auth.passwordMismatch);
        return;
      }
    }
    setLoading(true);
    try {
      const cfg = await tauriClient.authPrelogin(serverUrl, email, allowInsecureHttp);
      setWeakKdfMessage(evaluateWeakKdf(cfg));
      if (tab === 'login') {
        await login({
          serverUrl,
          email,
          masterPassword,
          twoFactorCode: twoFactorCode.trim() || undefined,
          allowInsecureHttp,
        });
      } else {
        await register({
          serverUrl,
          email,
          name,
          masterPassword,
          allowInsecureHttp,
        });
      }
      await refreshAll(getFilter());
    } catch (err) {
      if (err instanceof KeysmithIpcError && err.twoFactorRequired) {
        setTwoFactorVisible(true);
      }
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`h-dvh w-full flex flex-col bg-[var(--bg-sidebar)] ${
        customChrome && !isMaximized ? 'border border-[var(--border-strong)]' : ''
      }`}
    >
      {customChrome ? (
        <div className="relative h-10 w-full flex items-center justify-end pr-2 pt-1.5 shrink-0">
          <div
            data-tauri-drag-region
            onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
            className="absolute inset-0"
          />
          <WindowControls maximized={isMaximized} className="relative z-10" />
        </div>
      ) : (
        inTauri && <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-9" />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] rounded-xl bg-[var(--bg-elevated)] backdrop-blur-2xl border border-[var(--border-strong)] shadow-xl overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              {addingAccount ? (
                <button
                  type="button"
                  onClick={cancelAddingAccount}
                  aria-label={dict.auth.cancelAddAccount}
                  className="p-1.5 -ml-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <img
                  src="/logo.png"
                  alt="Keysmith"
                  className="w-9 h-9 rounded-lg object-cover shrink-0"
                />
              )}
              <div className="min-w-0">
                <h1 id="auth-signin-heading" className="text-[17px] font-semibold text-[var(--text-primary)] tracking-tight truncate">
                  {addingAccount ? dict.auth.addAccountTitle : dict.auth.title}
                </h1>
              </div>
            </div>

            <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-card)]/70 hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] cursor-pointer shrink-0">
              <Globe size={12} className="shrink-0" />
              <select
                aria-label={dict.settings.languageLabel}
                value={languageMode}
                onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}
                className="ks-select-inline text-[var(--text-secondary)]"
              >
                <option value="system">{dict.settings.languageSystem}</option>
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!addingAccount && savedAccounts.length > 0 && (
            <div className="mt-3.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-[var(--text-muted)]">{dict.auth.savedAccountsQuickSwitch}:</span>
              {savedAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => void switchAccount(acc.id)}
                  className="px-2.5 py-1 rounded-md bg-[var(--bg-sidebar)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--accent-primary)] cursor-pointer truncate max-w-[190px]"
                >
                  {acc.email}
                </button>
              ))}
            </div>
          )}

          {registrationDisabled ? (
            <div className="mt-4 px-3 py-2 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] flex items-center justify-between text-[13px]">
              <span className="font-medium text-[var(--text-primary)]">{dict.auth.loginTab}</span>
              <span className="text-xs text-[var(--text-muted)]">{dict.auth.regDisabledNotice}</span>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 p-0.5 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError(null);
                }}
                className={`py-2 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                  tab === 'login'
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {dict.auth.loginTab}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setError(null);
                }}
                className={`py-2 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                  tab === 'register'
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {dict.auth.registerTab}
              </button>
            </div>
          )}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-6 flex flex-col gap-3.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="auth-server" className="text-[13px] font-medium text-[var(--text-secondary)]">
                {dict.auth.serverUrl}
              </label>
              <button
                type="button"
                onClick={() => void checkServer()}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline cursor-pointer"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    serverOk === 'ok'
                      ? 'bg-[var(--status-success)]'
                      : serverOk === 'error'
                        ? 'bg-[var(--status-danger)]'
                        : 'bg-[var(--status-warning)]'
                  }`}
                />
                {serverOk === 'checking'
                  ? dict.auth.checkingServer
                  : serverOk === 'ok'
                    ? dict.auth.serverOk
                    : serverOk === 'error'
                      ? dict.auth.serverError
                      : dict.auth.checkServer}
              </button>
            </div>
            <div className="relative flex items-center">
              <Server size={14} className="absolute left-3 text-[var(--text-muted)]" />
              <input
                id="auth-server"
                type="url"
                required
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setServerOk('idle');
                  setAllowInsecureHttp(false);
                  setWeakKdfMessage(null);
                }}
                onBlur={() => void checkServer()}
                placeholder="https://vault.example.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            {serverOk === 'ok' && serverVersion && (
              <p className="mt-1 text-xs text-[var(--text-muted)] flex items-center gap-1">
                <CheckCircle2 size={12} className="text-[var(--status-success)]" />
                {serverVersion}
              </p>
            )}
            {nonLoopbackHttp && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{dict.auth.insecureHttpWarning}</span>
                </div>
                <label className="flex items-start gap-2 cursor-pointer select-none font-medium">
                  <input
                    type="checkbox"
                    checked={allowInsecureHttp}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAllowInsecureHttp(next);
                      if (next) {
                        void checkServer(serverUrl, true);
                      }
                    }}
                    className="mt-0.5 rounded border-amber-500/50"
                  />
                  <span>{dict.auth.insecureHttpConfirm}</span>
                </label>
              </div>
            )}
            {weakKdfMessage !== null && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{weakKdfMessage}</span>
              </div>
            )}
          </div>

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1">
                {dict.auth.displayName}
              </label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cherry"
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1">
              {dict.auth.email}
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete={tab === 'login' ? 'username webauthn' : 'username'}
              aria-describedby="auth-signin-heading"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => void probePrelogin()}
              placeholder="name@example.com"
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="auth-pw" className="text-[13px] font-medium text-[var(--text-secondary)]">
                {dict.auth.masterPassword}
              </label>
              {tab === 'login' && !twoFactorVisible && (
                <button
                  type="button"
                  onClick={() => setTwoFactorVisible(true)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-primary)] cursor-pointer"
                >
                  {dict.auth.use2fa}
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                id="auth-pw"
                type={showPw ? 'text' : 'password'}
                required
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••"
                className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? dict.common.hide : dict.common.show}
                className="absolute right-2.5 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {tab === 'register' && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(15, (strength.score + 1) * 20)}%`,
                      backgroundColor:
                        strength.score >= 3
                          ? 'var(--status-success)'
                          : strength.score === 2
                            ? 'var(--status-warning)'
                            : 'var(--status-danger)',
                    }}
                  />
                </div>
                <span className="text-xs text-[var(--text-secondary)]">
                  {dict.auth.passwordStrength}:{' '}
                  {(
                    [
                      dict.generator.strength0,
                      dict.generator.strength1,
                      dict.generator.strength2,
                      dict.generator.strength3,
                      dict.generator.strength4,
                    ] as const
                  )[strength.score] ?? strength.label}
                </span>
              </div>
            )}
          </div>

          {tab === 'login' && twoFactorVisible && (
            <div>
              <label htmlFor="auth-2fa" className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1">
                {dict.auth.twoFactorCode}
              </label>
              <div className="relative flex items-center">
                <KeyRound size={14} className="absolute left-3 text-[var(--text-muted)]" />
                <input
                  id="auth-2fa"
                  type="text"
                  inputMode="numeric"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
            </div>
          )}

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-pw2" className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1">
                {dict.auth.confirmMasterPassword}
              </label>
              <input
                id="auth-pw2"
                type={showPw ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-[13px] font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/25 text-[13px] text-[var(--status-danger)]">
              {error}
            </div>
          )}

          <div className="mt-1 flex items-center gap-2">
            {canCancelBack && addingAccount && (
              <button
                type="button"
                onClick={cancelAddingAccount}
                className="px-4 py-2.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                {dict.common.cancel}
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-[13.5px] font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {tab === 'login' ? dict.auth.signInBtn : dict.auth.registerBtn}
            </button>
          </div>

          {!inTauri && (
            <p className="text-xs text-center text-[var(--text-muted)]">
              {fmt(dict.auth.demoHint, { pw: 'keysmith' })}
            </p>
          )}
        </form>
      </div>
      </div>
      {customChrome && <WindowResizeHandles disabled={isMaximized} />}
    </div>
  );
}
