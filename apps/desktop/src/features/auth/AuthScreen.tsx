import { ArrowLeft, CheckCircle2, Eye, EyeOff, Fingerprint, Globe, KeyRound, Loader2, Server } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { evaluatePasswordStrength } from '../../services/generator';
import { isTauriRuntime, KeysmithIpcError, tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { AccountPasskey } from '../../types/domain';

export function AuthScreen() {
  const inTauri = isTauriRuntime();
  const { dict, locale, setLanguageMode, fmt } = useI18n();

  const addingAccount = useSessionStore((s) => s.addingAccount);
  const savedAccounts = useSessionStore((s) => s.savedAccounts);
  const appSettings = useSessionStore((s) => s.appSettings);
  const cancelAddingAccount = useSessionStore((s) => s.cancelAddingAccount);
  const switchAccount = useSessionStore((s) => s.switchAccount);
  const login = useSessionStore((s) => s.login);
  const loginWithPasskey = useSessionStore((s) => s.loginWithPasskey);
  const register = useSessionStore((s) => s.register);
  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState(
    inTauri ? appSettings.lastServerUrl ?? '' : 'http://localhost:8080',
  );
  const [serverOk, setServerOk] = useState<'idle' | 'checking' | 'ok' | 'error'>(
    inTauri ? 'idle' : 'ok',
  );
  const [serverVersion, setServerVersion] = useState(
    inTauri ? '' : 'Vaultwarden 1.32.5 (Local)',
  );
  const [registrationDisabled, setRegistrationDisabled] = useState(false);
  const [email, setEmail] = useState(inTauri ? '' : 'cherry@example.com');
  const [name, setName] = useState(inTauri ? '' : 'Cherry Wang');
  const [masterPassword, setMasterPassword] = useState(inTauri ? '' : 'keysmith');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorVisible, setTwoFactorVisible] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [accountPasskeys, setAccountPasskeys] = useState<AccountPasskey[]>([]);
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

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
    async (targetUrl = serverUrl) => {
      const cleanUrl = targetUrl.trim();
      if (!cleanUrl) return;
      setServerOk('checking');
      try {
        const res = await tauriClient.authCheckServer(cleanUrl);
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
    [serverUrl],
  );

  useEffect(() => {
    if (addingAccount) {
      setAccountPasskeys([]);
      return;
    }
    void tauriClient
      .accountPasskeyList()
      .then((res) => {
        setAccountPasskeys(res.credentials);
        if (res.credentials[0]) setSelectedPasskeyId(res.credentials[0].id);
      })
      .catch(() => {
        setAccountPasskeys([]);
      });
  }, [inTauri, addingAccount]);

  const probePrelogin = async () => {
    const cleanServer = serverUrl.trim();
    const cleanEmail = email.trim();
    if (!cleanServer || !cleanEmail || !cleanEmail.includes('@')) return;
    try {
      await tauriClient.authPrelogin(cleanServer, cleanEmail);
    } catch {
      // Silent on blur; handleSubmit surfaces errors
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setPasskeyLoading(true);
    try {
      await loginWithPasskey(selectedPasskeyId || undefined);
      await refreshAll(getFilter());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey error');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const strength = evaluatePasswordStrength(masterPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === 'register' && masterPassword !== confirmPassword) {
      setError(dict.auth.passwordMismatch);
      return;
    }
    setLoading(true);
    try {
      await tauriClient.authPrelogin(serverUrl, email);
      if (tab === 'login') {
        await login({
          serverUrl,
          email,
          masterPassword,
          twoFactorCode: twoFactorCode.trim() || undefined,
        });
      } else {
        await register({ serverUrl, email, name, masterPassword });
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
    <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] p-6">
      {inTauri && <div data-tauri-drag-region className="fixed top-0 left-0 right-0 h-9" />}
      <div className="w-full max-w-[420px] rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-xl overflow-hidden">
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
                <h1 id="auth-signin-heading" className="text-[16px] font-semibold text-[var(--text-primary)] tracking-tight truncate">
                  {addingAccount ? dict.auth.addAccountTitle : dict.auth.title}
                </h1>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLanguageMode(locale === 'zh-CN' ? 'en' : 'zh-CN')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] cursor-pointer shrink-0"
            >
              <Globe size={12} />
              {locale === 'zh-CN' ? 'EN' : '中文'}
            </button>
          </div>

          {!addingAccount && savedAccounts.length > 0 && (
            <div className="mt-3.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-[var(--text-muted)]">{dict.auth.savedAccountsQuickSwitch}:</span>
              {savedAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => void switchAccount(acc.id)}
                  className="px-2 py-0.5 rounded-md bg-[var(--bg-sidebar)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--accent-primary)] cursor-pointer truncate max-w-[190px]"
                >
                  {acc.email}
                </button>
              ))}
            </div>
          )}

          {registrationDisabled ? (
            <div className="mt-4 px-3 py-2 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)] flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--text-primary)]">{dict.auth.loginTab}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{dict.auth.regDisabledNotice}</span>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 p-0.5 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError(null);
                }}
                className={`py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
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
                className={`py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
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
              <label htmlFor="auth-server" className="text-xs font-medium text-[var(--text-secondary)]">
                {dict.auth.serverUrl}
              </label>
              <button
                type="button"
                onClick={() => void checkServer()}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline cursor-pointer"
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
              <Server size={13} className="absolute left-3 text-[var(--text-muted)]" />
              <input
                id="auth-server"
                type="url"
                required
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setServerOk('idle');
                }}
                onBlur={() => void checkServer()}
                placeholder="https://vault.example.com"
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            {serverOk === 'ok' && serverVersion && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                <CheckCircle2 size={11} className="text-[var(--status-success)]" />
                {serverVersion}
              </p>
            )}
          </div>

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {dict.auth.displayName}
              </label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cherry"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
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
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="auth-pw" className="text-xs font-medium text-[var(--text-secondary)]">
                {dict.auth.masterPassword}
              </label>
              {tab === 'login' && !twoFactorVisible && (
                <button
                  type="button"
                  onClick={() => setTwoFactorVisible(true)}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] cursor-pointer"
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
                className="w-full pl-3 pr-9 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? dict.common.hide : dict.common.show}
                className="absolute right-2.5 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
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
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {dict.auth.passwordStrength}: {strength.label}
                </span>
              </div>
            )}
          </div>

          {tab === 'login' && twoFactorVisible && (
            <div>
              <label htmlFor="auth-2fa" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {dict.auth.twoFactorCode}
              </label>
              <div className="relative flex items-center">
                <KeyRound size={13} className="absolute left-3 text-[var(--text-muted)]" />
                <input
                  id="auth-2fa"
                  type="text"
                  inputMode="numeric"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
            </div>
          )}

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-pw2" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
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
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/25 text-xs text-[var(--status-danger)]">
              {error}
            </div>
          )}

          <div className="mt-1 flex items-center gap-2">
            {canCancelBack && addingAccount && (
              <button
                type="button"
                onClick={cancelAddingAccount}
                className="px-4 py-2.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                {dict.common.cancel}
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {tab === 'login' ? dict.auth.signInBtn : dict.auth.registerBtn}
            </button>
          </div>

          {!addingAccount && tab === 'login' && accountPasskeys.length > 0 && (
            <div className="pt-2.5 border-t border-[var(--border-subtle)] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span>{dict.auth.orPasskey}</span>
                <select
                  value={selectedPasskeyId}
                  onChange={(e) => setSelectedPasskeyId(e.target.value)}
                  aria-label="Passkey"
                  className="ks-select-sm min-w-[110px]"
                >
                  {accountPasskeys.map((pk) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={passkeyLoading}
                onClick={() => void handlePasskeyLogin()}
                className="w-full py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {passkeyLoading ? (
                  <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                ) : (
                  <Fingerprint size={15} className="text-[var(--accent-primary)]" />
                )}
                {passkeyLoading ? dict.auth.verifyingPasskey : dict.auth.usePasskeyBtn}
              </button>
            </div>
          )}

          {!inTauri && (
            <p className="text-[11px] text-center text-[var(--text-muted)]">
              {fmt(dict.auth.demoHint, { pw: 'keysmith' })}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
