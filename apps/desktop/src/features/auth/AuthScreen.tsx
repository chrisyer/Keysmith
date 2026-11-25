import { CheckCircle2, Eye, EyeOff, Fingerprint, Loader2, Server, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { evaluatePasswordStrength } from '../../services/generator';
import { tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { AccountPasskey } from '../../types/domain';

export function AuthScreen() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [serverUrl, setServerUrl] = useState('http://localhost:8080');
  const [serverOk, setServerOk] = useState<'idle' | 'checking' | 'ok' | 'error'>('ok');
  const [serverVersion, setServerVersion] = useState('Vaultwarden 1.32.5 (Local)');
  const [email, setEmail] = useState('cherry@example.com');
  const [name, setName] = useState('Cherry Wang');
  const [masterPassword, setMasterPassword] = useState('keysmith');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [accountPasskeys, setAccountPasskeys] = useState<AccountPasskey[]>([]);
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const login = useSessionStore((s) => s.login);
  const loginWithPasskey = useSessionStore((s) => s.loginWithPasskey);
  const register = useSessionStore((s) => s.register);
  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  useEffect(() => {
    void tauriClient.accountPasskeyList().then((res) => {
      setAccountPasskeys(res.credentials);
      if (res.credentials[0]) setSelectedPasskeyId(res.credentials[0].id);
    });
  }, []);

  const handlePasskeyLogin = async () => {
    setError(null);
    setPasskeyLoading(true);
    try {
      await loginWithPasskey(selectedPasskeyId || undefined);
      await refreshAll(getFilter());
    } catch (err) {
      setError(err instanceof Error ? err.message : '通行密钥登录失败');
    } finally {
      setPasskeyLoading(false);
    }
  };

  const strength = evaluatePasswordStrength(masterPassword);

  const checkServer = async () => {
    setServerOk('checking');
    const res = await tauriClient.authCheckServer(serverUrl);
    setServerOk(res.ok ? 'ok' : 'error');
    setServerVersion(res.version);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (tab === 'register' && masterPassword !== confirmPassword) {
      setError('两次输入的主密码不一致');
      return;
    }
    setLoading(true);
    try {
      await tauriClient.authPrelogin(serverUrl, email);
      if (tab === 'login') {
        await login({ serverUrl, email, masterPassword });
      } else {
        await register({ serverUrl, email, name, masterPassword });
      }
      await refreshAll(getFilter());
    } catch (err) {
      setError(err instanceof Error ? err.message : '认证失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-dvh w-full flex items-center justify-center bg-[var(--bg-sidebar)] p-6">
      <div className="w-full max-w-[440px] rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl overflow-hidden">
        <div className="px-7 pt-7 pb-5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Keysmith"
                className="w-10 h-10 rounded-xl shadow-sm object-cover shrink-0"
              />
              <div>
                <h1 id="auth-signin-heading" className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
                  Keysmith
                </h1>
                <p className="text-xs text-[var(--text-secondary)]">
                  零知识客户端加密 · Vaultwarden 同步
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-[var(--bg-selected)] text-[var(--accent-primary)]">
              <ShieldCheck size={12} />
              Argon2id
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 p-1 rounded-xl bg-[var(--bg-sidebar)] border border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                tab === 'login'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              登录已有账户
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                tab === 'register'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              注册新账户
            </button>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-7 flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="auth-server" className="text-xs font-medium text-[var(--text-secondary)]">
                Vaultwarden 服务器地址
              </label>
              <button
                type="button"
                onClick={() => void checkServer()}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline cursor-pointer"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    serverOk === 'ok'
                      ? 'bg-[var(--status-success)]'
                      : serverOk === 'error'
                        ? 'bg-[var(--status-danger)]'
                        : 'bg-[var(--status-warning)]'
                  }`}
                />
                {serverOk === 'checking'
                  ? '检测中...'
                  : serverOk === 'ok'
                    ? '已连通'
                    : serverOk === 'error'
                      ? '不可达'
                      : '检测连通性'}
              </button>
            </div>
            <div className="relative flex items-center">
              <Server size={14} className="absolute left-3 text-[var(--text-muted)]" />
              <input
                id="auth-server"
                type="url"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setServerOk('idle');
                }}
                placeholder="http://localhost:8080"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
            {serverOk === 'ok' && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                <CheckCircle2 size={11} className="text-[var(--status-success)]" />
                {serverVersion}
              </p>
            )}
          </div>

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                显示名称
              </label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 Cherry Wang"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              账户邮箱
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete={tab === 'login' ? 'username webauthn' : 'username'}
              aria-describedby="auth-signin-heading"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="auth-pw" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              主密码（永不离开本机）
            </label>
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
                placeholder="输入主密码"
                className="w-full pl-3 pr-9 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? '隐藏主密码' : '显示主密码'}
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
                  强度：{strength.label}
                </span>
              </div>
            )}
          </div>

          {tab === 'register' && (
            <div>
              <label htmlFor="auth-pw2" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                确认主密码
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
                placeholder="再次输入主密码"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 text-xs text-[var(--status-danger)]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full py-2.5 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-xs font-semibold text-white flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {tab === 'login' ? '解锁并同步保险库' : '生成零知识密钥并注册'}
          </button>

          {tab === 'login' && accountPasskeys.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span>或使用已绑定的通行密钥免密登录</span>
                <select
                  value={selectedPasskeyId}
                  onChange={(e) => setSelectedPasskeyId(e.target.value)}
                  aria-label="选择账户通行密钥"
                  className="text-[11px] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[var(--text-primary)]"
                >
                  {accountPasskeys.map((pk) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.name} {pk.prfSupported ? '(PRF)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={passkeyLoading}
                onClick={() => void handlePasskeyLogin()}
                className="w-full py-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {passkeyLoading ? (
                  <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                ) : (
                  <Fingerprint size={15} className="text-[var(--accent-primary)]" />
                )}
                {passkeyLoading ? '正在验证 WebAuthn PRF 密钥...' : '使用通行密钥 (Passkey / PRF) 登录'}
              </button>
            </div>
          )}

          <p className="text-[11px] text-center text-[var(--text-muted)]">
            演示账户可直接点击登录（预填主密码 <code className="font-mono-tabular">keysmith</code>）
          </p>
        </form>
      </div>
    </div>
  );
}
