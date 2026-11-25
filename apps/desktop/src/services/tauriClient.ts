import type {
  AccountPasskey,
  AuthStatus,
  GeneratorOptions,
  GeneratorResult,
  ItemDetail,
  ItemDraft,
  ItemFilter,
  ItemSummary,
  KdfConfig,
  SessionState,
  SyncStatus,
  TotpCode,
  Vault,
  WatchtowerFlags,
  WatchtowerReport,
} from '../types/domain';
import { deriveSubtitle, makeId } from '../utils/format';
import { generateSecret } from './generator';
import {
  DEMO_ACCOUNT_USER_ID,
  DEMO_RP_ID,
  INITIAL_ACCOUNT_PASSKEYS,
  INITIAL_ITEMS,
  INITIAL_VAULTS,
} from './mockData';
import {
  APPLE_TOUCH_ID_AAGUID,
  YUBIKEY_5_AAGUID,
  generatePasskeyKeypair,
} from './passkey';
import { matchesSearchQuery } from './search';
import { computeTotp } from './totp';
import { runWatchtowerAudit, sha1PrefixHex } from './watchtower';

export type TauriEventMap = {
  'session:state_changed': { status: AuthStatus; reason?: string };
  'sync:status': SyncStatus;
  'sync:data_changed': { vaultChanged: boolean; updatedItemIds: string[]; deletedItemIds: string[] };
  'clipboard:cleared': { label: string };
  'clipboard:tick': { label: string; remainingSeconds: number; totalSeconds: number } | null;
};

type EventListener<K extends keyof TauriEventMap> = (payload: TauriEventMap[K]) => void;

class KeysmithPrototypeClient {
  private vaults: Omit<Vault, 'itemCount'>[] = INITIAL_VAULTS.map((v) => ({ ...v }));
  private items: ItemDetail[] = structuredClone(INITIAL_ITEMS);
  private accountPasskeys: AccountPasskey[] = structuredClone(INITIAL_ACCOUNT_PASSKEYS);
  private demoMasterPassword = 'keysmith';
  private hibpChecked = false;
  private hibpCheckedAt: string | undefined;

  private session: SessionState = {
    status: 'Unlocked',
    email: 'cherry@example.com',
    displayName: 'Cherry Wang',
    serverUrl: 'http://localhost:8080',
    biometricEnabled: true,
    autoLockMinutes: 15,
    clipboardClearSeconds: 30,
    lastSyncAt: new Date(Date.now() - 45_000).toISOString(),
    kdfType: 'Argon2id',
  };

  private syncStatusState: SyncStatus = {
    state: 'idle',
    pendingCount: 0,
    lastSyncAt: this.session.lastSyncAt,
    signalrConnected: true,
  };

  private listeners = new Map<keyof TauriEventMap, Set<EventListener<never>>>();
  private clipboardTimer: number | null = null;
  private clipboardState: { label: string; remainingSeconds: number; totalSeconds: number } | null = null;

  onEvent<K extends keyof TauriEventMap>(event: K, listener: EventListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as EventListener<never>);
    return () => {
      set?.delete(listener as EventListener<never>);
    };
  }

  private emit<K extends keyof TauriEventMap>(event: K, payload: TauriEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as EventListener<K>)(payload);
    }
  }

  // --- Auth & Session ---

  async authPrelogin(_serverUrl: string, _email: string): Promise<KdfConfig> {
    await new Promise((r) => setTimeout(r, 180));
    return { kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 4 };
  }

  async authCheckServer(serverUrl: string): Promise<{ ok: boolean; version: string }> {
    await new Promise((r) => setTimeout(r, 240));
    const valid = /^https?:\/\/.+/.test(serverUrl.trim());
    return { ok: valid, version: 'Vaultwarden 1.32.5 (Local)' };
  }

  async authLogin(params: {
    serverUrl: string;
    email: string;
    masterPassword: string;
    twoFactorCode?: string;
  }): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 320));
    if (!params.email.trim() || !params.masterPassword) {
      throw new Error('请输入邮箱与主密码');
    }
    this.demoMasterPassword = params.masterPassword;
    this.session = {
      ...this.session,
      status: 'Unlocked',
      email: params.email.trim().toLowerCase(),
      displayName: params.email.split('@')[0] || 'Keysmith User',
      serverUrl: params.serverUrl.trim(),
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'login' });
    return { ...this.session };
  }

  async authRegister(params: {
    serverUrl: string;
    email: string;
    name: string;
    masterPassword: string;
  }): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 380));
    if (!params.email.trim() || params.masterPassword.length < 6) {
      throw new Error('请填写有效邮箱与至少 6 位主密码');
    }
    this.demoMasterPassword = params.masterPassword;
    this.session = {
      ...this.session,
      status: 'Unlocked',
      email: params.email.trim().toLowerCase(),
      displayName: params.name.trim() || params.email.split('@')[0],
      serverUrl: params.serverUrl.trim(),
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'register' });
    return { ...this.session };
  }

  async authLogout(clearLocalCache = false): Promise<void> {
    if (clearLocalCache) {
      this.hibpChecked = false;
    }
    this.session = { ...this.session, status: 'Unauthenticated' };
    this.emit('session:state_changed', { status: 'Unauthenticated', reason: 'logout' });
  }

  async sessionGetState(): Promise<SessionState> {
    return { ...this.session };
  }

  async sessionUpdatePreferences(patch: Partial<Pick<SessionState, 'biometricEnabled' | 'autoLockMinutes' | 'clipboardClearSeconds'>>): Promise<SessionState> {
    this.session = { ...this.session, ...patch };
    return { ...this.session };
  }

  async sessionUnlockPassword(masterPassword: string): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 140));
    if (masterPassword !== this.demoMasterPassword) {
      throw new Error('主密码校验失败，请重试（演示密码：keysmith）');
    }
    this.session = { ...this.session, status: 'Unlocked' };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'password' });
    return { ...this.session };
  }

  async sessionUnlockBiometric(): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 420));
    this.session = { ...this.session, status: 'Unlocked' };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'biometric' });
    return { ...this.session };
  }

  async sessionLock(reason = 'manual'): Promise<void> {
    if (this.session.status !== 'Unlocked') return;
    this.session = { ...this.session, status: 'Locked' };
    this.emit('session:state_changed', { status: 'Locked', reason });
  }

  async sessionTouchActivity(): Promise<void> {
    // No-op in prototype; resets Rust core inactivity timer in Tauri v2
  }

  // --- Account Passkeys (WebAuthn + PRF) ---

  async authPasskeyLogin(credentialId?: string): Promise<SessionState> {
    await new Promise((r) => setTimeout(r, 360));
    const cred =
      (credentialId ? this.accountPasskeys.find((c) => c.id === credentialId) : undefined) ??
      this.accountPasskeys[0];
    if (!cred) {
      throw new Error('未找到可用的账户通行密钥，请使用主密码登录');
    }
    cred.counter += 1;
    cred.lastUsedAt = Date.now();
    this.session = {
      ...this.session,
      status: 'Unlocked',
      lastSyncAt: new Date().toISOString(),
    };
    this.emit('session:state_changed', { status: 'Unlocked', reason: 'passkey_prf' });
    return { ...this.session };
  }

  async accountPasskeyList(): Promise<{
    rpId: string;
    userId: string;
    credentials: AccountPasskey[];
  }> {
    return {
      rpId: DEMO_RP_ID,
      userId: DEMO_ACCOUNT_USER_ID,
      credentials: structuredClone(this.accountPasskeys),
    };
  }

  async accountPasskeyRegister(
    name: string,
    deviceType: 'multiDevice' | 'singleDevice',
  ): Promise<AccountPasskey> {
    const { credentialId, publicKeySpki } = await generatePasskeyKeypair();
    const created: AccountPasskey = {
      id: credentialId,
      passkeyUserId: DEMO_ACCOUNT_USER_ID,
      credentialPublicKey: publicKeySpki,
      credentialType: 'public-key',
      credentialDeviceType: deviceType,
      credentialBackedUp: deviceType === 'multiDevice',
      aaguid: deviceType === 'multiDevice' ? APPLE_TOUCH_ID_AAGUID : YUBIKEY_5_AAGUID,
      name: name.trim() || (deviceType === 'multiDevice' ? '新平台通行密钥' : '外置硬件安全密钥'),
      transports: deviceType === 'multiDevice' ? ['internal', 'hybrid'] : ['usb', 'nfc'],
      registeredAt: Date.now(),
      counter: 0,
      prfSupported: true,
    };
    this.accountPasskeys.push(created);
    return structuredClone(created);
  }

  async accountPasskeyRename(id: string, name: string): Promise<AccountPasskey> {
    const target = this.accountPasskeys.find((c) => c.id === id);
    if (!target) throw new Error('通行密钥不存在');
    target.name = name.trim() || target.name;
    return structuredClone(target);
  }

  async accountPasskeyDelete(id: string): Promise<void> {
    this.accountPasskeys = this.accountPasskeys.filter((c) => c.id !== id);
  }

  async accountUpdateProfile(displayName: string): Promise<{
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }> {
    const clean = displayName.trim() || this.session.displayName;
    this.session = { ...this.session, displayName: clean };
    return {
      rpId: DEMO_RP_ID,
      userId: DEMO_ACCOUNT_USER_ID,
      name: this.session.email,
      displayName: clean,
    };
  }

  // --- Vaults ---

  async vaultList(): Promise<Vault[]> {
    return this.vaults.map((v) => ({
      ...v,
      itemCount: this.items.filter((it) => !it.deletedAt && it.vaultId === v.id).length,
    }));
  }

  async vaultCreate(name: string, color = '#0572EC', icon = 'folder'): Promise<Vault> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('保险库名称不能为空');
    const created: Omit<Vault, 'itemCount'> = {
      id: makeId('vault'),
      name: trimmed,
      color,
      icon,
      isDefault: false,
    };
    this.vaults.push(created);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return { ...created, itemCount: 0 };
  }

  async vaultRename(id: string, name: string): Promise<Vault> {
    const v = this.vaults.find((item) => item.id === id);
    if (!v) throw new Error('保险库不存在');
    v.name = name.trim() || v.name;
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
    return {
      ...v,
      itemCount: this.items.filter((it) => !it.deletedAt && it.vaultId === v.id).length,
    };
  }

  async vaultDelete(id: string): Promise<void> {
    const target = this.vaults.find((v) => v.id === id);
    if (!target || target.isDefault) throw new Error('默认保险库不可删除');
    const fallback = this.vaults.find((v) => v.isDefault) ?? this.vaults[0];
    this.items = this.items.map((it) => (it.vaultId === id ? { ...it, vaultId: fallback.id } : it));
    this.vaults = this.vaults.filter((v) => v.id !== id);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [] });
  }

  // --- Items ---

  private toSummary(item: ItemDetail, report: WatchtowerReport): ItemSummary {
    const allFields = item.sections.flatMap((s) => s.fields);
    const username = allFields.find((f) => f.purpose === 'username' && f.value.trim())?.value.trim();
    const hasTotp = allFields.some((f) => f.fieldType === 'totp' && f.value.trim().length > 0);
    const hasPassword = allFields.some((f) => f.purpose === 'password' && f.value.trim().length > 0);
    const hasPasskey = (item.passkeys?.length ?? 0) > 0;
    return {
      id: item.id,
      vaultId: item.vaultId,
      title: item.title,
      subtitle: deriveSubtitle(item),
      category: item.category,
      icon: item.icon,
      tags: item.tags,
      favorite: item.favorite,
      hasTotp,
      hasPasskey,
      primaryUrl: item.urls[0]?.uri,
      username,
      hasPassword,
      deletedAt: item.deletedAt,
      updatedAt: item.updatedAt,
      issues: report.itemIssues[item.id] ?? [],
    };
  }

  async itemList(filter: ItemFilter = {}): Promise<ItemSummary[]> {
    const report = runWatchtowerAudit(this.items, {
      checkHibp: this.hibpChecked,
      hibpCheckedAt: this.hibpCheckedAt,
    });

    const filtered = this.items.filter((item) => {
      const isTrashed = Boolean(item.deletedAt);
      if (filter.trashed) {
        if (!isTrashed) return false;
      } else if (isTrashed) {
        return false;
      }

      if (filter.vaultId && item.vaultId !== filter.vaultId) return false;
      if (filter.category && item.category !== filter.category) return false;
      if (filter.favorite && !item.favorite) return false;
      if (filter.passkeyOnly && (item.passkeys?.length ?? 0) === 0 && item.category !== 'passkey') return false;
      if (filter.tag && !item.tags.includes(filter.tag)) return false;
      if (filter.watchtowerIssue) {
        const issues = report.itemIssues[item.id] ?? [];
        if (!issues.includes(filter.watchtowerIssue)) return false;
      }
      if (filter.query && !matchesSearchQuery(item, this.vaults as Vault[], filter.query)) {
        return false;
      }
      return true;
    });

    const sortBy = filter.sortBy ?? 'title_asc';
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title_desc':
          return b.title.localeCompare(a.title, 'zh-CN');
        case 'updated_desc':
          return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        case 'created_desc':
          return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        case 'title_asc':
        default:
          return a.title.localeCompare(b.title, 'zh-CN');
      }
    });

    return filtered.map((item) => this.toSummary(item, report));
  }

  async itemGetAllStats(): Promise<{
    totalCount: number;
    favoriteCount: number;
    passkeyCount: number;
    trashCount: number;
    categoryCounts: Record<string, number>;
    tagCounts: Array<{ tag: string; count: number }>;
  }> {
    const active = this.items.filter((i) => !i.deletedAt);
    const trashed = this.items.filter((i) => Boolean(i.deletedAt));
    const categoryCounts: Record<string, number> = {};
    const tagMap = new Map<string, number>();

    for (const item of active) {
      categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
      for (const tag of item.tags) {
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
      }
    }

    const tagCounts = Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));

    return {
      totalCount: active.length,
      favoriteCount: active.filter((i) => i.favorite).length,
      passkeyCount: active.filter((i) => (i.passkeys?.length ?? 0) > 0 || i.category === 'passkey').length,
      trashCount: trashed.length,
      categoryCounts,
      tagCounts,
    };
  }

  async itemGet(id: string): Promise<ItemDetail | null> {
    const found = this.items.find((i) => i.id === id);
    return found ? structuredClone(found) : null;
  }

  async itemCreate(draft: ItemDraft): Promise<ItemDetail> {
    const now = new Date().toISOString();
    const created: ItemDetail = {
      id: makeId('item'),
      vaultId: draft.vaultId,
      title: draft.title.trim() || '未命名条目',
      favorite: draft.favorite,
      schema: 'keysmith.item.v1',
      category: draft.category,
      subtitle: draft.subtitle,
      icon: draft.icon,
      tags: [...draft.tags],
      urls: structuredClone(draft.urls),
      sections: structuredClone(draft.sections),
      passkeys: structuredClone(draft.passkeys ?? []),
      notes: draft.notes,
      passwordHistory: [...draft.passwordHistory],
      watchtower: { ...draft.watchtower },
      createdAt: now,
      updatedAt: now,
    };
    this.items.unshift(created);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [created.id], deletedItemIds: [] });
    return structuredClone(created);
  }

  async itemUpdate(id: string, draft: ItemDraft): Promise<ItemDetail> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error('条目不存在');
    const prev = this.items[idx];
    const now = new Date().toISOString();

    // Archive changed primary password values into passwordHistory (docs/03 §2.5)
    const nextHistory = [...draft.passwordHistory];
    const prevPasswords = prev.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.purpose === 'password' && f.value.trim())
      .map((f) => ({ id: f.id, value: f.value }));

    for (const prevField of prevPasswords) {
      const nextField = draft.sections.flatMap((s) => s.fields).find((f) => f.id === prevField.id);
      if (nextField && nextField.value.trim() && nextField.value !== prevField.value) {
        if (!nextHistory.some((h) => h.value === prevField.value)) {
          nextHistory.unshift({ value: prevField.value, changedAt: now });
        }
      }
    }

    const updated: ItemDetail = {
      ...prev,
      vaultId: draft.vaultId,
      title: draft.title.trim() || prev.title,
      favorite: draft.favorite,
      category: draft.category,
      subtitle: draft.subtitle,
      icon: draft.icon,
      tags: [...draft.tags],
      urls: structuredClone(draft.urls),
      sections: structuredClone(draft.sections),
      passkeys: structuredClone(draft.passkeys ?? prev.passkeys ?? []),
      notes: draft.notes,
      passwordHistory: nextHistory.slice(0, 20),
      watchtower: { ...draft.watchtower },
      updatedAt: now,
    };

    this.items[idx] = updated;
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(updated);
  }

  async itemUpdateWatchtowerFlags(id: string, flags: Partial<WatchtowerFlags>): Promise<ItemDetail> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('条目不存在');
    item.watchtower = { ...item.watchtower, ...flags };
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(item);
  }

  async itemToggleFavorite(id: string, favorite: boolean): Promise<ItemDetail> {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('条目不存在');
    item.favorite = favorite;
    item.updatedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [id], deletedItemIds: [] });
    return structuredClone(item);
  }

  async itemTrash(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.deletedAt = new Date().toISOString();
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [id] });
  }

  async itemRestore(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    delete item.deletedAt;
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [id], deletedItemIds: [] });
  }

  async itemDeletePermanent(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit('sync:data_changed', { vaultChanged: true, updatedItemIds: [], deletedItemIds: [id] });
  }

  // --- Sync ---

  async syncGetStatus(): Promise<SyncStatus> {
    return { ...this.syncStatusState };
  }

  async syncNow(): Promise<SyncStatus> {
    this.syncStatusState = { ...this.syncStatusState, state: 'syncing' };
    this.emit('sync:status', { ...this.syncStatusState });
    await new Promise((r) => setTimeout(r, 650));
    const now = new Date().toISOString();
    this.session.lastSyncAt = now;
    this.syncStatusState = {
      state: 'idle',
      pendingCount: 0,
      lastSyncAt: now,
      signalrConnected: true,
    };
    this.emit('sync:status', { ...this.syncStatusState });
    this.emit('sync:data_changed', { vaultChanged: false, updatedItemIds: [], deletedItemIds: [] });
    return { ...this.syncStatusState };
  }

  // --- TOTP / Generator / Watchtower ---

  async totpCompute(secretOrUri: string): Promise<TotpCode> {
    return computeTotp(secretOrUri);
  }

  async generatorGenerate(options: GeneratorOptions): Promise<GeneratorResult> {
    return generateSecret(options);
  }

  async watchtowerScan(checkHibp = false): Promise<WatchtowerReport> {
    if (checkHibp) {
      // Simulate k-anonymity 5-char SHA-1 prefix lookup across unique passwords
      const samplePw = this.items[0]?.sections[0]?.fields[1]?.value ?? 'Keysmith';
      await sha1PrefixHex(samplePw);
      await new Promise((r) => setTimeout(r, 520));
      this.hibpChecked = true;
      this.hibpCheckedAt = new Date().toISOString();
    }
    return runWatchtowerAudit(this.items, {
      checkHibp: this.hibpChecked,
      hibpCheckedAt: this.hibpCheckedAt,
    });
  }

  // --- Clipboard Guard ---

  async clipboardCopySecret(text: string, label: string, isSensitive: boolean): Promise<void> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Fallback for non-focused or permission-restricted webviews
    }

    if (this.clipboardTimer !== null) {
      window.clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }

    if (!isSensitive) {
      this.clipboardState = null;
      this.emit('clipboard:tick', null);
      return;
    }

    const total = this.session.clipboardClearSeconds;
    if (total <= 0) {
      this.clipboardState = null;
      this.emit('clipboard:tick', null);
      return;
    }

    this.clipboardState = { label, remainingSeconds: total, totalSeconds: total };
    this.emit('clipboard:tick', { ...this.clipboardState });

    this.clipboardTimer = window.setInterval(() => {
      if (!this.clipboardState) return;
      this.clipboardState.remainingSeconds -= 1;
      if (this.clipboardState.remainingSeconds <= 0) {
        void this.clipboardClearNow();
      } else {
        this.emit('clipboard:tick', { ...this.clipboardState });
      }
    }, 1000);
  }

  async clipboardClearNow(): Promise<void> {
    const label = this.clipboardState?.label ?? '敏感内容';
    if (this.clipboardTimer !== null) {
      window.clearInterval(this.clipboardTimer);
      this.clipboardTimer = null;
    }
    this.clipboardState = null;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText('');
      }
    } catch {
      // ignore
    }
    this.emit('clipboard:tick', null);
    this.emit('clipboard:cleared', { label });
  }
}

export const tauriClient = new KeysmithPrototypeClient();
