import {
  Check,
  Fingerprint,
  Keyboard,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import {
  detectPasskeyCapabilities,
  resolveAaguidProvider,
  syncAcceptedCredentials,
  syncCurrentUserDetails,
} from '../../services/passkey';
import { tauriClient } from '../../services/tauriClient';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { AccountPasskey } from '../../types/domain';
import type { ThemeMode } from '../../utils/theme';

const SHORTCUTS = [
  ['⌘⇧Space / ⌘K', '呼出 / 隐藏 Quick Access 悬浮窗'],
  ['⌘F', '聚焦搜索框并全选搜索词'],
  ['⌘N', '打开新建条目模板选择器'],
  ['⌘E', '切换当前条目的查看 / 编辑模式'],
  ['⌘S', '保存编辑中的条目'],
  ['⌘C / ⌘⇧C', '复制主密码 / 复制用户名'],
  ['⌘⌥C', '复制 TOTP 验证码'],
  ['⌘⇧L', '打开 Large Type 大字展示'],
  ['⌘D', '星标收藏 / 取消收藏'],
  ['⌘⌫', '移入废纸篓'],
  ['⌘L', '立即锁定所有保险库'],
  ['⌘R', '立即向 Vaultwarden 触发同步'],
  ['⌘,', '打开偏好设置'],
];

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const themeMode = useUiStore((s) => s.themeMode);
  const systemPrefersDark = useUiStore((s) => s.systemPrefersDark);
  const setThemeMode = useUiStore((s) => s.setThemeMode);
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);

  const email = useSessionStore((s) => s.email);
  const displayName = useSessionStore((s) => s.displayName);
  const serverUrl = useSessionStore((s) => s.serverUrl);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const autoLockMinutes = useSessionStore((s) => s.autoLockMinutes);
  const clipboardClearSeconds = useSessionStore((s) => s.clipboardClearSeconds);
  const kdfType = useSessionStore((s) => s.kdfType);
  const updatePreferences = useSessionStore((s) => s.updatePreferences);
  const updateProfile = useSessionStore((s) => s.updateProfile);
  const logout = useSessionStore((s) => s.logout);

  const syncStatus = useVaultStore((s) => s.syncStatus);
  const syncNow = useVaultStore((s) => s.syncNow);

  const [tab, setTab] = useState<'appearance' | 'security' | 'passkeys' | 'sync' | 'shortcuts'>('appearance');
  const [passkeyRpId, setPasskeyRpId] = useState('');
  const [passkeyUserId, setPasskeyUserId] = useState('');
  const [accountPasskeys, setAccountPasskeys] = useState<AccountPasskey[]>([]);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState(displayName);

  useEffect(() => {
    setProfileNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!open || tab !== 'passkeys') return;
    let active = true;
    void Promise.all([tauriClient.accountPasskeyList(), detectPasskeyCapabilities()]).then(
      ([res, caps]) => {
        if (!active) return;
        setPasskeyRpId(res.rpId);
        setPasskeyUserId(res.userId);
        setAccountPasskeys(res.credentials);
        setPasskeySupported(caps.supported && caps.platformAuthenticator);
        void syncAcceptedCredentials(res.rpId, res.userId, res.credentials);
      },
    );
    return () => {
      active = false;
    };
  }, [open, tab]);

  const handleRegisterPasskey = async (deviceType: 'multiDevice' | 'singleDevice') => {
    const label = deviceType === 'multiDevice' ? 'MacBook · 平台通行密钥' : '硬件安全密钥 (USB/NFC)';
    await tauriClient.accountPasskeyRegister(label, deviceType);
    const updated = await tauriClient.accountPasskeyList();
    setAccountPasskeys(updated.credentials);
    showToast({ label: '通行密钥', text: `已注册「${label}」(支持 WebAuthn PRF)`, kind: 'info' });
  };

  const handleRenamePasskey = async (id: string) => {
    if (!editingPasskeyName.trim()) return;
    await tauriClient.accountPasskeyRename(id, editingPasskeyName);
    const updated = await tauriClient.accountPasskeyList();
    setAccountPasskeys(updated.credentials);
    setEditingPasskeyId(null);
  };

  const handleDeletePasskey = async (id: string) => {
    await tauriClient.accountPasskeyDelete(id);
    const updated = await tauriClient.accountPasskeyList();
    setAccountPasskeys(updated.credentials);
    void syncAcceptedCredentials(updated.rpId, updated.userId, updated.credentials);
    showToast({ label: '通行密钥', text: '已删除该账户通行密钥并触发 Signal API 同步', kind: 'info' });
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await updateProfile(profileNameDraft);
    await syncCurrentUserDetails(res.rpId, res.userId, res.name, res.displayName);
    showToast({ label: '账户信息', text: '已更新显示名称并同步至密码管理器', kind: 'info' });
  };

  const themeOptions: Array<{ id: ThemeMode; label: string; desc: string; icon: typeof Monitor }> = [
    {
      id: 'system',
      label: `跟随系统（当前${systemPrefersDark ? '深色' : '浅色'}）`,
      desc: '自动响应 macOS 外观切换',
      icon: Monitor,
    },
    {
      id: 'light',
      label: '浅色 (Light)',
      desc: '始终使用高对比度浅色三栏界面',
      icon: Sun,
    },
    {
      id: 'dark',
      label: '深色 (Dark)',
      desc: '始终使用深色护眼主题',
      icon: Moon,
    },
  ];

  return (
    <ModalDialog
      open={open}
      onClose={() => setSettingsOpen(false)}
      ariaLabelledBy="settings-title"
      closedBy="any"
      className="rounded-2xl w-[min(660px,92vw)] shadow-2xl"
    >
      <div className="flex flex-col max-h-[82dvh]">
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h1 id="settings-title" className="text-base font-semibold text-[var(--text-primary)]">
            偏好设置
          </h1>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭偏好设置"
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-[360px] overflow-hidden">
          <nav className="w-44 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-2.5 flex flex-col gap-1">
            {(
              [
                { id: 'appearance', label: '外观主题', icon: Palette },
                { id: 'security', label: '安全与锁屏', icon: Shield },
                { id: 'passkeys', label: '通行密钥', icon: Fingerprint },
                { id: 'sync', label: '同步与账户', icon: RefreshCw },
                { id: 'shortcuts', label: '快捷键矩阵', icon: Keyboard },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-left cursor-pointer ${
                    tab === item.id
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto ks-scroll p-6">
            {tab === 'appearance' && (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">界面主题</h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    通过 CSS <code className="font-mono-tabular">color-scheme</code> 与 <code className="font-mono-tabular">light-dark()</code> 实时切换明暗语义色板
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  {themeOptions.map((opt) => {
                    const Icon = opt.icon;
                    const active = themeMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setThemeMode(opt.id)}
                        className={`p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--bg-selected)] border-[var(--accent-primary)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon size={17} className={active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'} />
                          <div>
                            <div className="text-xs font-semibold text-[var(--text-primary)]">
                              {opt.label}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              {opt.desc}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            active ? 'border-[var(--accent-primary)]' : 'border-[var(--border-strong)]'
                          }`}
                        >
                          {active && <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === 'security' && (
              <div className="flex flex-col gap-5 text-xs">
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">macOS Touch ID 解锁</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      将 64B UserSymmetricKey 存入受 <code className="font-mono-tabular">kSecAccessControlBiometryCurrentSet</code> 保护的 Keychain
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={biometricEnabled}
                    onChange={(e) => void updatePreferences({ biometricEnabled: e.target.checked })}
                    className="ks-checkbox"
                    aria-label="启用 Touch ID 解锁"
                  />
                </div>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">空闲自动锁定</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      无操作超时后立即 zeroize 擦除内存密钥与索引
                    </div>
                  </div>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => void updatePreferences({ autoLockMinutes: Number(e.target.value) })}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)]"
                  >
                    <option value={1}>1 分钟</option>
                    <option value={5}>5 分钟</option>
                    <option value={15}>15 分钟 (默认)</option>
                    <option value={30}>30 分钟</option>
                    <option value={60}>60 分钟</option>
                    <option value={0}>永不</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">敏感剪贴板自动清除</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      写入 <code className="font-mono-tabular">ConcealedType</code> 标记，并在到期时校验摘要后清空
                    </div>
                  </div>
                  <select
                    value={clipboardClearSeconds}
                    onChange={(e) => void updatePreferences({ clipboardClearSeconds: Number(e.target.value) })}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)]"
                  >
                    <option value={10}>10 秒</option>
                    <option value={20}>20 秒</option>
                    <option value={30}>30 秒 (默认)</option>
                    <option value={60}>60 秒</option>
                    <option value={0}>不自动清除</option>
                  </select>
                </label>
              </div>
            )}

            {tab === 'passkeys' && (
              <div className="flex flex-col gap-4 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      账户通行密钥管理 (WebAuthn + PRF)
                    </h2>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                      用于免主密码登录/解锁 Keysmith；RP ID: <code className="font-mono-tabular">{passkeyRpId}</code> · User ID: <code className="font-mono-tabular">{passkeyUserId.slice(0, 14)}…</code>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {passkeySupported && (
                      <button
                        type="button"
                        onClick={() => void handleRegisterPasskey('multiDevice')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-[11px] font-medium cursor-pointer"
                      >
                        <Plus size={12} />
                        创建平台通行密钥
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRegisterPasskey('singleDevice')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-[11px] font-medium cursor-pointer"
                    >
                      <Plus size={12} />
                      注册硬件密钥
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {accountPasskeys.length === 0 ? (
                    <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-[var(--text-secondary)]">
                      暂无已注册的账户通行密钥
                    </div>
                  ) : (
                    accountPasskeys.map((cred) => {
                      const provider = resolveAaguidProvider(cred.aaguid);
                      const isRenaming = editingPasskeyId === cred.id;
                      return (
                        <div
                          key={cred.id}
                          className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div
                              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: provider.color }}
                              title={provider.name}
                            >
                              {provider.badgeText}
                            </div>
                            <div className="min-w-0 flex-1">
                              {isRenaming ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editingPasskeyName}
                                    onChange={(e) => setEditingPasskeyName(e.target.value)}
                                    className="px-2 py-1 rounded bg-[var(--bg-input)] border border-[var(--accent-primary)] text-xs text-[var(--text-primary)]"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleRenamePasskey(cred.id)}
                                    aria-label="保存名称"
                                    className="p-1 rounded bg-[var(--accent-primary)] text-white cursor-pointer"
                                  >
                                    <Check size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-[var(--text-primary)] truncate">
                                    {cred.name}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)]">
                                    {cred.credentialDeviceType === 'multiDevice' ? '云同步多设备' : '单设备硬件密钥'}
                                  </span>
                                  {cred.prfSupported && (
                                    <span className="px-1.5 py-0.5 rounded bg-sky-500/12 text-sky-600 dark:text-sky-400 text-[10px] font-medium">
                                      PRF 免密
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                                提供方：{provider.name} · 注册于 {new Date(cred.registeredAt).toLocaleDateString('zh-CN')}
                                {cred.lastUsedAt
                                  ? ` · 最近使用 ${new Date(cred.lastUsedAt).toLocaleDateString('zh-CN')}`
                                  : ''}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPasskeyId(cred.id);
                                setEditingPasskeyName(cred.name);
                              }}
                              aria-label={`重命名 ${cred.name}`}
                              className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeletePasskey(cred.id)}
                              aria-label={`删除 ${cred.name}`}
                              className="p-1.5 rounded-lg hover:bg-[var(--status-danger)]/10 text-[var(--text-secondary)] hover:text-[var(--status-danger)] cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  onSubmit={(e) => void handleProfileSave(e)}
                  className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-end justify-between gap-3"
                >
                  <div className="flex-1">
                    <label htmlFor="pk-profile-name" className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                      账户显示名称（修改后通过 WebAuthn Signal API 同步至管理器）
                    </label>
                    <input
                      id="pk-profile-name"
                      type="text"
                      value={profileNameDraft}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                  >
                    同步名称
                  </button>
                </form>
              </div>
            )}

            {tab === 'sync' && (
              <div className="flex flex-col gap-4 text-xs">
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">当前账户</span>
                    <span className="font-medium text-[var(--text-primary)]">{email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">Vaultwarden 实例</span>
                    <span className="font-mono-tabular text-[var(--text-primary)]">{serverUrl}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">密钥派生 (KDF)</span>
                    <span className="font-mono-tabular text-[var(--accent-primary)]">{kdfType} (64MiB, t=3, p=4)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">SignalR 实时推送</span>
                    <span className="inline-flex items-center gap-1.5 text-[var(--status-success)] font-medium">
                      <span className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
                      {syncStatus.signalrConnected ? '已连接 (/notifications/hub)' : '离线'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">本地离线缓存</span>
                    <span className="text-[var(--text-primary)]">SQLite · EncString Type 2 零明文落盘</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await syncNow(getFilter());
                      showToast({ label: '同步', text: '已完成与 Vaultwarden 的增量密文同步', kind: 'info' });
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
                  >
                    <RefreshCw size={13} />
                    立即同步 (⌘R)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      void logout(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--status-danger)]/40 text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 text-xs font-medium cursor-pointer"
                  >
                    <LogOut size={13} />
                    登出并切换账户
                  </button>
                </div>
              </div>
            )}

            {tab === 'shortcuts' && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-[var(--text-secondary)] mb-1">
                  对齐 1Password 8 macOS 快捷键体系（浏览器预览环境下可用 <code className="font-mono-tabular">⌘K</code> 替代系统全局 <code className="font-mono-tabular">⌘⇧Space</code>）：
                </p>
                <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {SHORTCUTS.map(([keys, desc]) => (
                    <div key={keys} className="px-3.5 py-2 flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{desc}</span>
                      <kbd className="px-2 py-0.5 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)] font-mono-tabular text-[11px] text-[var(--text-primary)]">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
