import { ArrowRight, Fingerprint, KeyRound, Loader2, Lock, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

export function LockScreen() {
  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const unlockWithPassword = useSessionStore((s) => s.unlockWithPassword);
  const unlockWithBiometric = useSessionStore((s) => s.unlockWithBiometric);
  const loginWithPasskey = useSessionStore((s) => s.loginWithPasskey);
  const logout = useSessionStore((s) => s.logout);

  const getFilter = useUiStore((s) => s.getFilter);
  const refreshAll = useVaultStore((s) => s.refreshAll);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [touchScanning, setTouchScanning] = useState(false);
  const [passkeyScanning, setPasskeyScanning] = useState(false);

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
      setError(err instanceof Error ? err.message : '主密码不正确');
      triggerShake();
    } finally {
      setUnlocking(false);
    }
  };

  const handleTouchId = async () => {
    setTouchScanning(true);
    setError(null);
    try {
      await unlockWithBiometric();
      await refreshAll(getFilter());
    } finally {
      setTouchScanning(false);
    }
  };

  const handlePasskeyUnlock = async () => {
    setPasskeyScanning(true);
    setError(null);
    try {
      await loginWithPasskey();
      await refreshAll(getFilter());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey 解锁失败');
    } finally {
      setPasskeyScanning(false);
    }
  };

  const initials = (displayName || email || 'K').slice(0, 2).toUpperCase();

  return (
    <div className="h-dvh w-full flex flex-col items-center justify-center bg-[var(--bg-sidebar)] p-6">
      <div className="w-full max-w-[380px] rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl p-8 flex flex-col items-center text-center">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0572EC] to-[#3B93FF] text-white text-xl font-bold flex items-center justify-center shadow-md">
            {initials}
          </div>
          <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--accent-primary)] shadow-xs">
            <Lock size={13} />
          </div>
        </div>

        <h1 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{displayName}</h1>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{email}</p>
        <span className="mt-2 px-2.5 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[10px] font-mono-tabular text-[var(--text-muted)]">
          {serverUrl}
        </span>

        <form onSubmit={(e) => void handlePasswordUnlock(e)} className="w-full mt-6 flex flex-col gap-3">
          <div className={`relative flex items-center ${shaking ? 'ks-shake' : ''}`}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="输入主密码以解锁（演示：keysmith）"
              aria-label="主密码"
              className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={unlocking || !password}
              aria-label="解锁"
              className="absolute right-1.5 p-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white transition-colors cursor-pointer"
            >
              {unlocking ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            </button>
          </div>

          {error && (
            <p className="text-[11px] text-[var(--status-danger)] text-left px-1">{error}</p>
          )}
        </form>

        {biometricEnabled && (
          <button
            type="button"
            onClick={() => void handleTouchId()}
            disabled={touchScanning}
            className="mt-4 w-full py-2.5 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Fingerprint
              size={17}
              className={touchScanning ? 'text-[var(--accent-primary)] animate-pulse' : 'text-[var(--status-danger)]'}
            />
            {touchScanning ? '正在验证 Touch ID...' : '使用 Touch ID 快捷解锁'}
          </button>
        )}

        <button
          type="button"
          onClick={() => void handlePasskeyUnlock()}
          disabled={passkeyScanning}
          className="mt-2.5 w-full py-2 rounded-xl bg-transparent hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <KeyRound size={14} className={passkeyScanning ? 'text-[var(--accent-primary)] animate-pulse' : 'text-[var(--accent-primary)]'} />
          {passkeyScanning ? '正在通过 WebAuthn PRF 解密...' : '使用 Passkey / 硬件安全密钥解锁'}
        </button>

        <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] w-full flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>内存密钥已擦除</span>
          <button
            type="button"
            onClick={() => void logout(false)}
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <LogOut size={12} />
            切换账户 / 登出
          </button>
        </div>
      </div>
    </div>
  );
}
