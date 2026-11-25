import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Fingerprint,
  Hash,
  History,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldOff,
  Star,
  Trash2,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ColoredPassword } from '../../components/ColoredPassword';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { TotpRow } from '../../components/TotpRow';
import { tauriClient } from '../../services/tauriClient';
import { TEMPLATE_MAP } from '../../services/templates';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { ItemDetail, ItemField, WatchtowerIssueType } from '../../types/domain';
import { extractDomain, formatCardNumber, formatDateTime, maskCardNumber } from '../../utils/format';

const ISSUE_META: Record<WatchtowerIssueType, { label: string; desc: string }> = {
  weak: { label: '弱密码', desc: '密码复杂度低于安全阈值，建议立即使用生成器替换。' },
  reused: { label: '密码复用', desc: '此密码与其他条目相同，存在撞库风险。' },
  missing_2fa: { label: '未开启 2FA', desc: '登录网站缺少 TOTP 动态口令保护。' },
  unsecured_url: { label: '不安全 HTTP', desc: '网址使用明文 HTTP 协议，可能被窃听。' },
  expiring: { label: '即将过期或已过期', desc: '卡片或授权有效期已临近或超过当前日期。' },
  breached: { label: '已知泄露密码', desc: 'HIBP k-匿名检测命中公开泄露库，请立即更换。' },
};

const MATCH_RULE_LABELS: Record<string, string> = {
  domain: '主域匹配',
  host: '精确主机',
  starts_with: '前缀匹配',
  exact: '完全匹配',
  never: '仅跳转',
};

function renderNotesLines(notes: string) {
  return notes.split('\n').map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      return (
        <h4 key={i} className="text-xs font-semibold text-[var(--text-primary)] mt-2 mb-1">
          {trimmed.slice(4)}
        </h4>
      );
    }
    if (trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
      return (
        <p key={i} className="text-[13px] leading-relaxed text-[var(--text-secondary)] pl-2">
          {line}
        </p>
      );
    }
    if (!trimmed) return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {line}
      </p>
    );
  });
}

interface FieldRowProps {
  field: ItemField;
  revealed: boolean;
  onToggleReveal: () => void;
  onCopy: (text: string, label: string, sensitive: boolean) => void;
  onLargeType: (label: string, value: string) => void;
}

function FieldRow({ field, revealed, onToggleReveal, onCopy, onLargeType }: FieldRowProps) {
  const [justCopied, setJustCopied] = useState(false);

  if (field.fieldType === 'totp' && field.value.trim()) {
    return <TotpRow label={field.label} secretOrUri={field.value} />;
  }

  const displayValue = (() => {
    if (!field.value) return '—';
    if (field.purpose === 'card_number') {
      return revealed ? formatCardNumber(field.value) : maskCardNumber(field.value);
    }
    return field.value;
  })();

  const handleCopy = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!field.value) return;
    onCopy(field.value, field.label, field.sensitive);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 1400);
  };

  const isMultiline =
    field.fieldType === 'multiline' ||
    field.fieldType === 'ssh_private_key' ||
    field.fieldType === 'ssh_public_key' ||
    field.value.includes('\n');

  const isMono =
    field.sensitive ||
    field.fieldType === 'password' ||
    field.fieldType === 'number' ||
    field.fieldType === 'ssh_private_key' ||
    field.fieldType === 'ssh_public_key';

  return (
    <div
      onClick={() => {
        if (field.copyable && field.value) handleCopy();
      }}
      className={`group relative flex items-start justify-between gap-3 px-4 py-3 rounded-lg hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)] transition-colors ${
        field.copyable && field.value ? 'cursor-pointer' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-[var(--text-secondary)]">{field.label}</div>
        <div className="mt-1 text-[13.5px] leading-relaxed" data-selectable="true">
          {field.sensitive && field.purpose !== 'card_number' ? (
            isMultiline && !revealed ? (
              <span className="font-mono-tabular tracking-[0.18em] text-[var(--text-secondary)]">
                ••••••••••••
              </span>
            ) : (
              <ColoredPassword value={field.value || '—'} revealed={revealed || !field.value} />
            )
          ) : (
            <span
              className={`${isMono ? 'font-mono-tabular' : ''} ${
                isMultiline ? 'whitespace-pre-wrap break-all text-xs' : 'break-all'
              } text-[var(--text-primary)]`}
            >
              {displayValue}
            </span>
          )}
        </div>
      </div>

      {/* Hover / Focus Reveal Action Bar */}
      <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-1 shrink-0 pt-1">
        {field.sensitive && field.value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleReveal();
            }}
            title={revealed ? '隐藏' : '显示明文'}
            aria-label={revealed ? `隐藏${field.label}` : `显示${field.label}`}
            className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {field.sensitive && field.value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLargeType(field.label, field.value);
            }}
            title="大字展示 (Large Type)"
            aria-label={`大字展示${field.label}`}
            className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            <Maximize2 size={14} />
          </button>
        )}
        {field.copyable && field.value && (
          <button
            type="button"
            onClick={handleCopy}
            title="复制"
            aria-label={`复制${field.label}`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-selected)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            {justCopied ? (
              <>
                <Check size={13} className="text-[var(--status-success)]" />
                <span className="text-[var(--status-success)]">已复制</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>复制</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

interface ItemDetailPaneProps {
  item: ItemDetail;
}

export function ItemDetailPane({ item }: ItemDetailPaneProps) {
  const uid = useId().replace(/:/g, '');
  const menuId = `item-more-${uid}`;
  const menuAnchor = `--item-more-${uid}`;
  const menuRef = useRef<HTMLDivElement>(null);

  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmUnbindCredId, setConfirmUnbindCredId] = useState<string | null>(null);

  const vaults = useVaultStore((s) => s.vaults);
  const watchtowerReport = useVaultStore((s) => s.watchtowerReport);
  const toggleFavorite = useVaultStore((s) => s.toggleFavorite);
  const trashItem = useVaultStore((s) => s.trashItem);
  const restoreItem = useVaultStore((s) => s.restoreItem);
  const deletePermanent = useVaultStore((s) => s.deletePermanent);
  const updateWatchtowerFlags = useVaultStore((s) => s.updateWatchtowerFlags);
  const updateItem = useVaultStore((s) => s.updateItem);

  const clearSec = useSessionStore((s) => s.clipboardClearSeconds);
  const getFilter = useUiStore((s) => s.getFilter);
  const startEditingExisting = useUiStore((s) => s.startEditingExisting);
  const openLargeType = useUiStore((s) => s.openLargeType);
  const showToast = useUiStore((s) => s.showToast);
  const setViewTag = useUiStore((s) => s.setViewTag);

  const vault = vaults.find((v) => v.id === item.vaultId);
  const tpl = TEMPLATE_MAP[item.category];
  const itemIssues = watchtowerReport?.itemIssues[item.id] ?? [];

  const allFields = item.sections.flatMap((s) => s.fields);
  const passwordField = allFields.find((f) => f.purpose === 'password' && f.value);
  const usernameField = allFields.find((f) => f.purpose === 'username' && f.value);
  const totpField = allFields.find((f) => f.fieldType === 'totp' && f.value);

  const handleCopy = async (text: string, label: string, sensitive: boolean) => {
    await tauriClient.clipboardCopySecret(text, label, sensitive);
    showToast({
      label,
      text: sensitive
        ? `已复制「${label}」· ${clearSec} 秒后自动清空剪贴板`
        : `已复制「${label}」`,
      kind: sensitive ? 'clipboard' : 'info',
    });
  };

  const handleIgnoreIssues = async () => {
    const flags: Record<string, boolean> = {};
    if (itemIssues.includes('weak')) flags.ignoreWeak = true;
    if (itemIssues.includes('reused')) flags.ignoreReused = true;
    if (itemIssues.includes('missing_2fa')) flags.ignoreMissing2fa = true;
    if (itemIssues.includes('unsecured_url')) flags.ignoreUnsecuredUrl = true;
    await updateWatchtowerFlags(item.id, flags, getFilter());
    showToast({ label: 'Watchtower', text: '已忽略当前条目的此项安全提醒', kind: 'info' });
  };

  const handleRestorePassword = async (oldValue: string) => {
    if (!passwordField) return;
    const nextSections = item.sections.map((sec) => ({
      ...sec,
      fields: sec.fields.map((f) => (f.id === passwordField.id ? { ...f, value: oldValue } : f)),
    }));
    await updateItem(
      item.id,
      {
        id: item.id,
        vaultId: item.vaultId,
        title: item.title,
        favorite: item.favorite,
        category: item.category,
        subtitle: item.subtitle,
        icon: item.icon,
        tags: item.tags,
        urls: item.urls,
        sections: nextSections,
        passkeys: item.passkeys,
        notes: item.notes,
        passwordHistory: item.passwordHistory,
        watchtower: item.watchtower,
      },
      getFilter(),
    );
    showToast({ label: '密码历史', text: '已还原历史密码，原密码已归档至历史记录', kind: 'info' });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-detail)] overflow-hidden">
      {/* Sticky Header */}
      <header className="px-7 pt-6 pb-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <ItemIconBadge icon={item.icon} category={item.category} title={item.title} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight truncate">
                {item.title}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                {tpl.label}
              </span>
              {vault && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vault.color }} />
                  {vault.name}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">
              {item.urls[0]?.uri ? extractDomain(item.urls[0].uri) : item.subtitle || tpl.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void toggleFavorite(item.id, !item.favorite, getFilter())}
            title={item.favorite ? '取消收藏 (⌘D)' : '星标收藏 (⌘D)'}
            aria-label={item.favorite ? '取消收藏' : '星标收藏'}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
          >
            <Star
              size={16}
              className={item.favorite ? 'text-amber-500 fill-amber-500' : 'text-[var(--text-muted)]'}
            />
          </button>

          {!item.deletedAt && (
            <button
              type="button"
              onClick={startEditingExisting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <Pencil size={13} />
              编辑
            </button>
          )}

          <button
            type="button"
            popoverTarget={menuId}
            style={{ anchorName: menuAnchor } as React.CSSProperties}
            aria-label="更多条目操作"
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <MoreHorizontal size={16} />
          </button>

          <div
            ref={menuRef}
            id={menuId}
            popover="auto"
            style={{ positionAnchor: menuAnchor } as React.CSSProperties}
            className="ks-popover ks-anchored-popover-end w-[200px]"
          >
            <div className="p-1.5 flex flex-col gap-0.5 text-xs">
              {passwordField && (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    void handleCopy(passwordField.value, passwordField.label, true);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>复制密码</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">⌘C</span>
                </button>
              )}
              {usernameField && (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    void handleCopy(usernameField.value, usernameField.label, false);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>复制用户名</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">⌘⇧C</span>
                </button>
              )}
              {totpField && (
                <button
                  type="button"
                  onClick={async () => {
                    menuRef.current?.hidePopover?.();
                    const res = await tauriClient.totpCompute(totpField.value);
                    await handleCopy(res.code, '一次性密码', true);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>复制 TOTP 验证码</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">⌘⌥C</span>
                </button>
              )}
              {passwordField && (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    openLargeType(passwordField.label, passwordField.value);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>Large Type 大字展示</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">⌘⇧L</span>
                </button>
              )}
              <div className="my-1 border-t border-[var(--border-subtle)]" />
              {item.deletedAt ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      menuRef.current?.hidePopover?.();
                      void restoreItem(item.id, getFilter());
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left text-[var(--accent-primary)] cursor-pointer"
                  >
                    从废纸篓恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      menuRef.current?.hidePopover?.();
                      void deletePermanent(item.id, getFilter());
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--status-danger)]/10 text-left text-[var(--status-danger)] cursor-pointer"
                  >
                    永久删除
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    void trashItem(item.id, getFilter());
                    showToast({ label: '废纸篓', text: `已将「${item.title}」移入废纸篓`, kind: 'info' });
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--status-danger)]/10 text-left flex items-center justify-between text-[var(--status-danger)] cursor-pointer"
                >
                  <span>移入废纸篓</span>
                  <span className="text-[10px] opacity-70 font-mono-tabular">⌘⌫</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto ks-scroll px-7 py-5 space-y-5">
        {/* Trash Banner */}
        {item.deletedAt && (
          <div className="p-3.5 rounded-xl bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--text-primary)]">
              此条目位于废纸篓（删除于 {formatDateTime(item.deletedAt)}）
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void restoreItem(item.id, getFilter())}
                className="px-3 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                恢复条目
              </button>
              <button
                type="button"
                onClick={() => void deletePermanent(item.id, getFilter())}
                className="px-3 py-1 rounded-lg bg-[var(--status-danger)] text-xs font-medium text-white cursor-pointer"
              >
                永久删除
              </button>
            </div>
          </div>
        )}

        {/* Watchtower Risk Banner */}
        {!item.deletedAt && itemIssues.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[var(--status-warning)]/10 border border-[var(--status-warning)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-[var(--text-primary)]">
                  Watchtower 安全提醒：{itemIssues.map((k) => ISSUE_META[k].label).join(' · ')}
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  {ISSUE_META[itemIssues[0]].desc}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={startEditingExisting}
                className="px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] text-white text-[11px] font-medium cursor-pointer"
              >
                立即修复
              </button>
              {itemIssues.some((i) => i !== 'expiring' && i !== 'breached') && (
                <button
                  type="button"
                  onClick={() => void handleIgnoreIssues()}
                  title="忽略可豁免的风险提醒"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                >
                  <ShieldOff size={12} />
                  忽略
                </button>
              )}
            </div>
          </div>
        )}

        {/* Credit Card Visual Preview */}
        {item.category === 'credit_card' && (() => {
          const holder = allFields.find((f) => f.label.includes('持卡人'))?.value || 'CARDHOLDER';
          const num = allFields.find((f) => f.purpose === 'card_number')?.value || '';
          const exp = allFields.find((f) => f.purpose === 'card_expiry')?.value || 'MM/YY';
          const brand = allFields.find((f) => f.label.includes('卡类型'))?.value || 'CARD';
          const showCardNum = Boolean(revealedIds['card-preview']);
          return (
            <div
              onClick={() => setRevealedIds((p) => ({ ...p, 'card-preview': !p['card-preview'] }))}
              className="w-full max-w-[380px] rounded-2xl p-5 bg-gradient-to-br from-[#0F2942] via-[#123A5C] to-[#0D9488] text-white shadow-lg cursor-pointer select-none"
              title="点击切换卡号显隐"
            >
              <div className="flex items-center justify-between text-xs text-white/75">
                <span className="font-semibold tracking-wider uppercase">{brand}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15">点击切换显示</span>
              </div>
              <div className="font-mono-tabular text-lg tracking-widest mt-5 font-semibold">
                {showCardNum ? formatCardNumber(num) : maskCardNumber(num)}
              </div>
              <div className="flex items-end justify-between mt-5 text-xs">
                <div>
                  <div className="text-[10px] text-white/60 uppercase">Holder</div>
                  <div className="font-medium tracking-wide mt-0.5">{holder}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-white/60 uppercase">Expires</div>
                  <div className="font-mono-tabular font-medium mt-0.5">{exp}</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Sections */}
        {item.sections.map((section) => {
          if (section.fields.length === 0) return null;
          const isCollapsed = Boolean(collapsedSections[section.id]);

          return (
            <div
              key={section.id}
              className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden"
            >
              {section.title && (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedSections((p) => ({ ...p, [section.id]: !p[section.id] }))
                  }
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-b border-[var(--border-subtle)] cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    {section.title}
                  </span>
                  <span className="font-mono-tabular text-[10px] text-[var(--text-muted)]">
                    {section.fields.length} 项
                  </span>
                </button>
              )}

              {!isCollapsed && (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {section.fields.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      revealed={Boolean(revealedIds[field.id])}
                      onToggleReveal={() =>
                        setRevealedIds((p) => ({ ...p, [field.id]: !p[field.id] }))
                      }
                      onCopy={(text, label, sens) => void handleCopy(text, label, sens)}
                      onLargeType={openLargeType}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Passkeys Section (Read-only Metadata & Unbind) */}
        {item.passkeys.length > 0 ? (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <Fingerprint size={14} className="text-sky-500" />
                已保存的通行密钥 (Passkey · {item.passkeys.length})
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">由网站 WebAuthn 自动绑定</span>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
              {item.passkeys.map((pk) => {
                const isConfirming = confirmUnbindCredId === pk.credentialId;
                return (
                  <div key={pk.credentialId} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                            {pk.rpName} ({pk.rpId})
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/12 text-sky-600 dark:text-sky-400 text-[10px] font-mono-tabular font-medium">
                            {pk.algorithm === -7 ? 'ES256 · P-256' : 'EdDSA'}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                          账户：{pk.userName} · 创建于 {formatDateTime(pk.createdAt)} · 签名 {pk.signCount} 次
                          {pk.lastUsedAt ? ` · 最近使用 ${formatDateTime(pk.lastUsedAt)}` : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`https://${pk.rpId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)]"
                        >
                          <span>前往网站管理</span>
                          <ExternalLink size={12} />
                        </a>
                        {!item.deletedAt && !isConfirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmUnbindCredId(pk.credentialId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-[var(--status-danger)]/10 border border-[var(--border-subtle)] text-xs font-medium text-[var(--status-danger)] cursor-pointer"
                          >
                            <Trash2 size={12} />
                            移除
                          </button>
                        )}
                      </div>
                    </div>

                    {isConfirming && (
                      <div className="p-3 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--text-primary)]">
                          仅从 Keysmith 移除本地与同步凭据，请同步前往 {pk.rpId} 安全设置撤销对应公钥。
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmUnbindCredId(null)}
                            className="px-2.5 py-1 rounded-md bg-[var(--bg-detail)] border border-[var(--border-strong)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const nextPasskeys = item.passkeys.filter(
                                (x) => x.credentialId !== pk.credentialId,
                              );
                              setConfirmUnbindCredId(null);
                              if (item.category === 'passkey' && nextPasskeys.length === 0) {
                                await trashItem(item.id, getFilter());
                              } else {
                                await updateItem(
                                  item.id,
                                  {
                                    id: item.id,
                                    vaultId: item.vaultId,
                                    title: item.title,
                                    favorite: item.favorite,
                                    category: item.category,
                                    subtitle: item.subtitle,
                                    icon: item.icon,
                                    tags: item.tags,
                                    urls: item.urls,
                                    sections: item.sections,
                                    passkeys: nextPasskeys,
                                    notes: item.notes,
                                    passwordHistory: item.passwordHistory,
                                    watchtower: item.watchtower,
                                  },
                                  getFilter(),
                                );
                              }
                              showToast({
                                label: '通行密钥',
                                text: `已移除 ${pk.rpId} 通行密钥，请记得在网站端同步撤销`,
                                kind: 'warning',
                              });
                            }}
                            className="px-2.5 py-1 rounded-md bg-[var(--status-danger)] text-white text-[11px] font-medium cursor-pointer"
                          >
                            确认移除
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[11px]">
                      <span className="font-mono-tabular text-[var(--text-muted)] truncate">
                        Credential ID: {pk.credentialId}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopy(pk.credentialId, 'Passkey Credential ID', false)}
                        className="text-[var(--accent-primary)] hover:underline shrink-0 cursor-pointer"
                      >
                        复制 ID
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          !item.deletedAt &&
          item.category === 'login' && (
            <div className="rounded-xl bg-[var(--bg-card)]/60 border border-dashed border-[var(--border-strong)] px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                <Fingerprint size={15} className="text-sky-500 shrink-0" />
                <span>在网站账户安全设置中添加通行密钥时，Keysmith 扩展或 macOS 自动填充将自动唤起保存</span>
              </div>
              {item.urls[0]?.uri && (
                <a
                  href={item.urls[0].uri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-selected)] border border-[var(--border-strong)] text-xs font-medium text-[var(--accent-primary)] shrink-0"
                >
                  <span>前往网站</span>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          )
        )}

        {/* URLs */}
        {item.urls.length > 0 && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
            {item.urls.map((u) => (
              <div
                key={u.id}
                className="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {u.label || '网址'}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                      {MATCH_RULE_LABELS[u.matchRule] ?? u.matchRule}
                    </span>
                  </div>
                  <a
                    href={u.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[13px] font-mono-tabular text-[var(--accent-primary)] hover:underline truncate mt-0.5"
                  >
                    {u.uri}
                  </a>
                </div>

                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCopy(u.uri, u.label || '网址', false)}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                    aria-label="复制网址"
                  >
                    <Copy size={13} />
                  </button>
                  <a
                    href={u.uri}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="在新标签页打开网址"
                    className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)]"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        {item.notes.trim() && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] px-4 py-3.5">
            <div className="text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">备注</div>
            <div data-selectable="true">{renderNotesLines(item.notes)}</div>
          </div>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex items-center flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setViewTag(tag)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
              >
                <Hash size={11} />
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Password History */}
        {item.passwordHistory.length > 0 && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <History size={14} />
                密码历史记录 ({item.passwordHistory.length})
              </span>
              {historyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {historyOpen && (
              <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {item.passwordHistory.map((hist, idx) => {
                  const key = `hist-${idx}`;
                  const isShown = Boolean(revealedIds[key]);
                  return (
                    <div
                      key={idx}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <ColoredPassword value={hist.value} revealed={isShown} />
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          归档于 {formatDateTime(hist.changedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setRevealedIds((p) => ({ ...p, [key]: !p[key] }))}
                          aria-label={isShown ? '隐藏历史密码' : '显示历史密码'}
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                        >
                          {isShown ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopy(hist.value, '历史密码', true)}
                          aria-label="复制历史密码"
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                        >
                          <Copy size={13} />
                        </button>
                        {passwordField && (
                          <button
                            type="button"
                            onClick={() => void handleRestorePassword(hist.value)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-selected)] text-[11px] font-medium text-[var(--accent-primary)] cursor-pointer"
                          >
                            <RotateCcw size={11} />
                            还原
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer Timestamps */}
        <div className="pt-2 pb-4 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>更新于 {formatDateTime(item.updatedAt)}</span>
          <span>创建于 {formatDateTime(item.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
