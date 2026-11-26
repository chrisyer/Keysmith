import {
  AlertTriangle,
  Archive,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  Fingerprint,
  FolderInput,
  Hash,
  History,
  Image as ImageIcon,
  Lock,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  ShieldOff,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ColoredPassword } from '../../components/ColoredPassword';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { TotpRow } from '../../components/TotpRow';
import { useI18n } from '../../i18n';
import { isTauriRuntime, tauriClient } from '../../services/tauriClient';
import { TEMPLATE_MAP } from '../../services/templates';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { AttachmentDownloadResult, ItemDetail, ItemField, OrganizationInfo } from '../../types/domain';
import { extractDomain, formatCardNumber, formatDateTime, maskCardNumber } from '../../utils/format';
import { openExternalUrl } from '../../utils/opener';
import { formatShortcutMac } from '../../utils/shortcuts';

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
        <p key={i} className="text-[13px] leading-relaxed text-[var(--text-primary)] pl-2">
          {line}
        </p>
      );
    }
    if (!trimmed) return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-[13px] leading-relaxed text-[var(--text-primary)]">
        {line}
      </p>
    );
  });
}

interface FieldRowProps {
  field: ItemField;
  revealed: boolean;
  repromptLocked?: boolean;
  onRequireReprompt?: () => void;
  onToggleReveal: () => void;
  onCopy: (text: string, label: string, sensitive: boolean) => void;
  onLargeType: (label: string, value: string) => void;
}

function FieldRow({
  field,
  revealed,
  repromptLocked = false,
  onRequireReprompt,
  onToggleReveal,
  onCopy,
  onLargeType,
}: FieldRowProps) {
  const { dict, fmt } = useI18n();
  const [justCopied, setJustCopied] = useState(false);

  if (field.fieldType === 'totp' && field.value.trim()) {
    if (repromptLocked) {
      return (
        <div
          onClick={() => onRequireReprompt?.()}
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer"
        >
          <div>
            <div className="text-[11.5px] font-medium text-[var(--text-secondary)]">{field.label}</div>
            <div className="mt-1 font-mono-tabular tracking-[0.18em] text-[13.5px] text-[var(--text-muted)]">
              ••••••
            </div>
          </div>
          <Lock size={14} className="text-[var(--text-muted)]" />
        </div>
      );
    }
    return <TotpRow label={field.label} secretOrUri={field.value} />;
  }

  const displayValue = (() => {
    if (!field.value) return '—';
    if (repromptLocked && field.sensitive) return '••••••••••••';
    if (field.purpose === 'card_number') {
      return revealed ? formatCardNumber(field.value) : maskCardNumber(field.value);
    }
    return field.value;
  })();

  const handleCopy = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!field.value) return;
    if (repromptLocked && field.sensitive) {
      onRequireReprompt?.();
      return;
    }
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
        <div className="text-xs font-medium text-[var(--text-secondary)]">{field.label}</div>
        <div className="mt-1 text-sm leading-relaxed" data-selectable="true">
          {field.sensitive && field.purpose !== 'card_number' ? (
            (isMultiline && !revealed) || repromptLocked ? (
              <span className="font-mono-tabular tracking-[0.18em] text-[var(--text-secondary)]">
                ••••••••••••
              </span>
            ) : (
              <ColoredPassword value={field.value || '—'} revealed={revealed || !field.value} />
            )
          ) : (
            <span
              className={`${isMono ? 'font-mono-tabular' : ''} ${
                isMultiline ? 'whitespace-pre-wrap break-all text-[13px]' : 'break-all'
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
              if (repromptLocked) {
                onRequireReprompt?.();
                return;
              }
              onToggleReveal();
            }}
            title={revealed ? dict.detail.hideFieldTitle : dict.detail.showFieldTitle}
            aria-label={fmt(revealed ? dict.detail.hideFieldAria : dict.detail.showFieldAria, { label: field.label })}
            className="p-2 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            {revealed && !repromptLocked ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        {field.sensitive && field.value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (repromptLocked) {
                onRequireReprompt?.();
                return;
              }
              onLargeType(field.label, field.value);
            }}
            title={dict.detail.largeTypeTitle}
            aria-label={fmt(dict.detail.largeTypeFieldAria, { label: field.label })}
            className="p-2 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            <Maximize2 size={15} />
          </button>
        )}
        {field.copyable && field.value && (
          <button
            type="button"
            onClick={handleCopy}
            title={dict.common.copy}
            aria-label={fmt(dict.detail.copyFieldAria, { label: field.label })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
          >
            {justCopied ? (
              <>
                <Check size={13} className="text-[var(--status-success)]" />
                <span className="text-[var(--status-success)]">{dict.common.copied}</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>{dict.common.copy}</span>
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
  const { dict, fmt } = useI18n();
  const uid = useId().replace(/:/g, '');
  const menuId = `item-more-${uid}`;
  const menuAnchor = `--item-more-${uid}`;
  const menuRef = useRef<HTMLDivElement>(null);

  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmUnbindCredId, setConfirmUnbindCredId] = useState<string | null>(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [shareOrgOpen, setShareOrgOpen] = useState(false);
  const [orgs, setOrgs] = useState<OrganizationInfo[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [sharingOrg, setSharingOrg] = useState(false);
  const [uploadingAtt, setUploadingAtt] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<AttachmentDownloadResult | null>(null);
  const [repromptPw, setRepromptPw] = useState('');
  const [repromptBusy, setRepromptBusy] = useState(false);
  const [repromptErr, setRepromptErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const repromptInputRef = useRef<HTMLInputElement>(null);

  const vaults = useVaultStore((s) => s.vaults);
  const watchtowerReport = useVaultStore((s) => s.watchtowerReport);
  const toggleFavorite = useVaultStore((s) => s.toggleFavorite);
  const duplicateItem = useVaultStore((s) => s.duplicateItem);
  const setItemArchived = useVaultStore((s) => s.setItemArchived);
  const moveItemsToVault = useVaultStore((s) => s.moveItemsToVault);
  const selectItem = useVaultStore((s) => s.selectItem);
  const refreshItems = useVaultStore((s) => s.refreshItems);
  const trashItem = useVaultStore((s) => s.trashItem);
  const restoreItem = useVaultStore((s) => s.restoreItem);
  const deletePermanent = useVaultStore((s) => s.deletePermanent);
  const updateWatchtowerFlags = useVaultStore((s) => s.updateWatchtowerFlags);
  const updateItem = useVaultStore((s) => s.updateItem);

  const clearSec = useSessionStore((s) => s.clipboardClearSeconds);
  const biometricEnabled = useSessionStore((s) => s.biometricEnabled);
  const shortcuts = useUiStore((s) => s.shortcuts);
  const repromptVerifiedIds = useUiStore((s) => s.repromptVerifiedIds);
  const markRepromptVerified = useUiStore((s) => s.markRepromptVerified);
  const getFilter = useUiStore((s) => s.getFilter);
  const startEditingExisting = useUiStore((s) => s.startEditingExisting);
  const openLargeType = useUiStore((s) => s.openLargeType);
  const openSendWithPrefill = useUiStore((s) => s.openSendWithPrefill);
  const showToast = useUiStore((s) => s.showToast);
  const setViewTag = useUiStore((s) => s.setViewTag);

  useEffect(() => {
    setRepromptPw('');
    setRepromptErr(null);
  }, [item.id]);

  const repromptLocked = Boolean(item.reprompt) && !repromptVerifiedIds[item.id];

  const vault = vaults.find((v) => v.id === item.vaultId);
  const tpl = TEMPLATE_MAP[item.category] ?? TEMPLATE_MAP.login;
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
        ? fmt(dict.detail.copiedSensitiveToast, { label, secs: clearSec })
        : fmt(dict.detail.copiedPlainToast, { label }),
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
    showToast({ label: dict.sidebar.watchtower, text: dict.detail.watchtowerIgnoreToast, kind: 'info' });
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
        reprompt: item.reprompt,
      },
      getFilter(),
    );
    showToast({
      label: dict.detail.passwordRestoredLabel,
      text: dict.detail.passwordRestoredToast,
      kind: 'info',
    });
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAtt(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error(dict.detail.fileReadFailed));
        reader.readAsDataURL(file);
      });
      await tauriClient.attachmentUpload(item.id, file.name, base64);
      await refreshItems(getFilter());
      await selectItem(item.id);
      showToast({
        label: dict.detail.encryptedAttachmentLabel,
        text: fmt(dict.detail.attachmentUploadedToast, { name: file.name }),
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.detail.attachmentUploadFailedLabel,
        text: err instanceof Error ? err.message : dict.detail.attachmentUploadFailedText,
        kind: 'warning',
      });
    } finally {
      setUploadingAtt(false);
    }
  };

  const handleAttachmentDownload = async (attachmentId: string, previewOnly = false) => {
    try {
      const res = await tauriClient.attachmentDownload(item.id, attachmentId);
      if (previewOnly && res.mimeType.startsWith('image/')) {
        setPreviewAtt(res);
        return;
      }
      const binary = atob(res.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast({
        label: dict.detail.attachmentReadFailedLabel,
        text: err instanceof Error ? err.message : dict.detail.attachmentReadFailedText,
        kind: 'warning',
      });
    }
  };

  const handleAttachmentDelete = async (attachmentId: string, fileName: string) => {
    try {
      await tauriClient.attachmentDelete(item.id, attachmentId);
      await refreshItems(getFilter());
      await selectItem(item.id);
      showToast({
        label: dict.detail.encryptedAttachmentLabel,
        text: fmt(dict.detail.attachmentDeletedToast, { name: fileName }),
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.detail.attachmentDeleteFailedLabel,
        text: err instanceof Error ? err.message : dict.detail.attachmentDeleteFailedText,
        kind: 'warning',
      });
    }
  };

  const focusRepromptPrompt = () => {
    repromptInputRef.current?.focus();
    repromptInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleVerifyRepromptPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repromptPw) return;
    setRepromptBusy(true);
    setRepromptErr(null);
    try {
      await tauriClient.sessionUnlockPassword(repromptPw);
      markRepromptVerified(item.id);
      setRepromptPw('');
      showToast({ label: item.title, text: dict.detail.repromptVerifiedToast, kind: 'info' });
    } catch {
      setRepromptErr(dict.detail.repromptWrongPw);
    } finally {
      setRepromptBusy(false);
    }
  };

  const handleVerifyRepromptBiometric = async () => {
    setRepromptBusy(true);
    setRepromptErr(null);
    try {
      await tauriClient.sessionUnlockBiometric();
      markRepromptVerified(item.id);
      showToast({ label: item.title, text: dict.detail.repromptVerifiedToast, kind: 'info' });
    } catch (err) {
      setRepromptErr(err instanceof Error ? err.message : dict.detail.repromptWrongPw);
    } finally {
      setRepromptBusy(false);
    }
  };

  const handleShareViaSend = () => {
    if (repromptLocked) {
      focusRepromptPrompt();
      return;
    }
    const lines: string[] = [];
    for (const sec of item.sections) {
      for (const f of sec.fields) {
        if (f.value.trim()) {
          lines.push(`${f.label}: ${f.value}`);
        }
      }
    }
    if (item.notes.trim()) {
      lines.push('');
      lines.push(item.notes.trim());
    }
    openSendWithPrefill({
      name: fmt(dict.send.oneClickName, { title: item.title }),
      text: lines.join('\n') || item.title,
    });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-detail)] overflow-hidden">
      {/* Sticky Header */}
      <header className="px-5 sm:px-7 pt-5 pb-4 border-b border-[var(--border-subtle)] flex flex-wrap items-start justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3.5 min-w-[200px] flex-1">
          <ItemIconBadge icon={item.icon} category={item.category} title={item.title} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight truncate">
                {item.title}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                {dict.categories[item.category] ?? tpl.label}
              </span>
              {vault && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vault.color }} />
                  {vault.name}
                </span>
              )}
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1 truncate">
              {item.urls[0]?.uri ? extractDomain(item.urls[0].uri) : item.subtitle || tpl.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void toggleFavorite(item.id, !item.favorite, getFilter())}
            title={item.favorite ? dict.detail.favoriteRemoveTitle : dict.detail.favoriteAddTitle}
            aria-label={item.favorite ? dict.detail.favoriteRemoveAria : dict.detail.favoriteAddAria}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
          >
            <Star
              size={17}
              className={item.favorite ? 'text-amber-500 fill-amber-500' : 'text-[var(--text-muted)]'}
            />
          </button>

          {!item.deletedAt && (
            <>
              <button
                type="button"
                onClick={handleShareViaSend}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors cursor-pointer"
              >
                <Send size={14} />
                {dict.detail.sendShare}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (repromptLocked) {
                    focusRepromptPrompt();
                    return;
                  }
                  startEditingExisting();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <Pencil size={14} />
                {dict.common.edit}
              </button>
            </>
          )}

          <button
            type="button"
            popoverTarget={menuId}
            style={{ anchorName: menuAnchor } as React.CSSProperties}
            aria-label={dict.detail.moreActionsAria}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <MoreHorizontal size={17} />
          </button>

          <div
            ref={menuRef}
            id={menuId}
            popover="auto"
            style={{ positionAnchor: menuAnchor } as React.CSSProperties}
            className="ks-popover ks-anchored-popover-end w-[210px]"
          >
            <div className="p-1.5 flex flex-col gap-0.5 text-[13px]">
              {passwordField && !repromptLocked && (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    void handleCopy(passwordField.value, passwordField.label, true);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>{dict.detail.copyPassword}</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">
                    {formatShortcutMac(shortcuts.copyPassword)}
                  </span>
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
                  <span>{dict.detail.copyUsername}</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">
                    {formatShortcutMac(shortcuts.copyUsername)}
                  </span>
                </button>
              )}
              {totpField && !repromptLocked && (
                <button
                  type="button"
                  onClick={async () => {
                    menuRef.current?.hidePopover?.();
                    const res = await tauriClient.totpCompute(totpField.value);
                    await handleCopy(res.code, 'TOTP', true);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>{dict.detail.copyTotp}</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">
                    {formatShortcutMac(shortcuts.copyTotp)}
                  </span>
                </button>
              )}
              {passwordField && !repromptLocked && (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    openLargeType(passwordField.label, passwordField.value);
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                >
                  <span>{dict.detail.largeType}</span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono-tabular">
                    {formatShortcutMac(shortcuts.largeType)}
                  </span>
                </button>
              )}
              <div className="my-1 border-t border-[var(--border-subtle)]" />
              {!item.deletedAt && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      menuRef.current?.hidePopover?.();
                      await duplicateItem(item.id, getFilter());
                      showToast({ label: dict.detail.duplicate, text: `${dict.detail.duplicate}: ${item.title}`, kind: 'info' });
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center gap-2 text-[var(--text-primary)] cursor-pointer"
                  >
                    <CopyPlus size={13} />
                    <span>{dict.detail.duplicate}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoveMenuOpen((v) => !v)}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center justify-between text-[var(--text-primary)] cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <FolderInput size={13} />
                      <span>{dict.detail.moveToVault}</span>
                    </span>
                    <ChevronRight size={12} />
                  </button>
                  {moveMenuOpen && (
                    <div className="pl-4 pr-1 py-1 flex flex-col gap-0.5 border-l border-[var(--border-subtle)] ml-2">
                      {vaults
                        .filter((v) => v.id !== item.vaultId && !v.isOrganization)
                        .map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={async () => {
                              menuRef.current?.hidePopover?.();
                              setMoveMenuOpen(false);
                              await moveItemsToVault([item.id], v.id, getFilter());
                              showToast({ label: v.name, text: `${item.title} → ${v.name}`, kind: 'info' });
                            }}
                            className="px-2 py-1.5 rounded-md hover:bg-[var(--bg-selected)] text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer truncate"
                          >
                            {v.name}
                          </button>
                        ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      menuRef.current?.hidePopover?.();
                      try {
                        const list = await tauriClient.organizationList();
                        const usable = list.filter((o) => o.hasKey && o.collections.length > 0);
                        setOrgs(usable);
                        if (usable.length > 0) {
                          setSelectedOrgId(usable[0].id);
                          setSelectedCollectionIds([usable[0].collections[0].id]);
                          setShareOrgOpen(true);
                        } else {
                          showToast({
                            label: dict.detail.shareToOrg,
                            text: dict.detail.noOrgsAvailable,
                            kind: 'info',
                          });
                        }
                      } catch (err) {
                        showToast({
                          label: dict.detail.shareToOrg,
                          text: err instanceof Error ? err.message : dict.detail.noOrgsAvailable,
                          kind: 'info',
                        });
                      }
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center gap-2 text-[var(--text-primary)] cursor-pointer"
                  >
                    <Building2 size={13} />
                    <span>{dict.detail.shareToOrg}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      menuRef.current?.hidePopover?.();
                      const nextArchived = !item.archived;
                      await setItemArchived(item.id, nextArchived, getFilter());
                      showToast({
                        label: dict.detail.archiveItem,
                        text: `${nextArchived ? dict.detail.archiveItem : dict.detail.unarchive}: ${item.title}`,
                        kind: 'info',
                      });
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-left flex items-center gap-2 text-[var(--text-primary)] cursor-pointer"
                  >
                    <Archive size={13} />
                    <span>{item.archived ? dict.detail.unarchive : dict.detail.archiveItem}</span>
                  </button>
                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                </>
              )}
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
                    {dict.detail.restoreFromTrash}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      menuRef.current?.hidePopover?.();
                      void deletePermanent(item.id, getFilter());
                    }}
                    className="px-2.5 py-2 rounded-lg hover:bg-[var(--status-danger)]/10 text-left text-[var(--status-danger)] cursor-pointer"
                  >
                    {dict.detail.deleteForever}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    menuRef.current?.hidePopover?.();
                    void trashItem(item.id, getFilter());
                    showToast({ label: dict.sidebar.trash, text: `${dict.detail.moveToTrash}: ${item.title}`, kind: 'info' });
                  }}
                  className="px-2.5 py-2 rounded-lg hover:bg-[var(--status-danger)]/10 text-left flex items-center justify-between text-[var(--status-danger)] cursor-pointer"
                >
                  <span>{dict.detail.moveToTrash}</span>
                  <span className="text-[10px] opacity-70 font-mono-tabular">
                    {formatShortcutMac(shortcuts.moveToTrash)}
                  </span>
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
              {fmt(dict.detail.trashedBanner, { time: formatDateTime(item.deletedAt) })}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void restoreItem(item.id, getFilter())}
                className="px-3 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                {dict.detail.restoreFromTrash}
              </button>
              <button
                type="button"
                onClick={() => void deletePermanent(item.id, getFilter())}
                className="px-3 py-1 rounded-lg bg-[var(--status-danger)] text-xs font-medium text-white cursor-pointer"
              >
                {dict.detail.deleteForever}
              </button>
            </div>
          </div>
        )}

        {/* Archive Banner */}
        {!item.deletedAt && item.archived && (
          <div className="p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-strong)] flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
              <Archive size={14} className="text-[var(--accent-primary)] shrink-0" />
              {dict.detail.archivedBanner}
            </div>
            <button
              type="button"
              onClick={() => void setItemArchived(item.id, false, getFilter())}
              className="px-3 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] shrink-0 cursor-pointer"
            >
              {dict.detail.unarchive}
            </button>
          </div>
        )}

        {/* Reprompt Verification Card */}
        {repromptLocked && (
          <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--accent-primary)]/35 flex flex-col gap-3">
            <div className="flex items-start gap-2.5">
              <Lock size={16} className="text-[var(--accent-primary)] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {dict.detail.repromptTitle}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  {dict.detail.repromptDesc}
                </div>
              </div>
            </div>
            <form
              onSubmit={(e) => void handleVerifyRepromptPassword(e)}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                ref={repromptInputRef}
                type="password"
                value={repromptPw}
                onChange={(e) => setRepromptPw(e.target.value)}
                placeholder={dict.detail.repromptPlaceholder}
                className="ks-input flex-1 min-w-[160px]"
              />
              <button
                type="submit"
                disabled={repromptBusy || !repromptPw}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-45 text-xs font-medium text-white cursor-pointer"
              >
                {dict.detail.repromptVerifyPw}
              </button>
              {biometricEnabled && isTauriRuntime() && (
                <button
                  type="button"
                  disabled={repromptBusy}
                  onClick={() => void handleVerifyRepromptBiometric()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] cursor-pointer"
                >
                  <Fingerprint size={13} />
                  {dict.detail.repromptUseTouchId}
                </button>
              )}
            </form>
            {repromptErr && (
              <div className="text-[11px] text-[var(--status-danger)]">{repromptErr}</div>
            )}
          </div>
        )}

        {/* Watchtower Risk Banner */}
        {!item.deletedAt && itemIssues.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[var(--status-warning)]/10 border border-[var(--status-warning)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-[var(--status-warning)] shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-[var(--text-primary)]">
                  {fmt(dict.detail.watchtowerBanner, {
                    labels: itemIssues.map((k) => dict.detail.issues[k] ?? k).join(' · '),
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={startEditingExisting}
                className="px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] text-white text-[11px] font-medium cursor-pointer"
              >
                {dict.detail.fixNow}
              </button>
              {itemIssues.some((i) => i !== 'expiring' && i !== 'breached') && (
                <button
                  type="button"
                  onClick={() => void handleIgnoreIssues()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                >
                  <ShieldOff size={12} />
                  {dict.detail.ignore}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Credit Card Visual Preview */}
        {item.category === 'credit_card' && (() => {
          const holder = allFields.find((f) => f.label.includes('持卡人') || f.label.toLowerCase().includes('holder'))?.value || 'CARDHOLDER';
          const num = allFields.find((f) => f.purpose === 'card_number')?.value || '';
          const exp = allFields.find((f) => f.purpose === 'card_expiry')?.value || 'MM/YY';
          const brand = allFields.find((f) => f.label.includes('卡类型') || f.label.toLowerCase().includes('type') || f.label.toLowerCase().includes('brand'))?.value || 'CARD';
          const showCardNum = Boolean(revealedIds['card-preview']);
          return (
            <div
              onClick={() => setRevealedIds((p) => ({ ...p, 'card-preview': !p['card-preview'] }))}
              className="w-full max-w-[380px] rounded-2xl p-5 bg-gradient-to-br from-[#0F2942] via-[#123A5C] to-[#0D9488] text-white shadow-lg cursor-pointer select-none"
              title={dict.detail.cardClickTitle}
            >
              <div className="flex items-center justify-between text-xs text-white/75">
                <span className="font-semibold tracking-wider uppercase">{brand}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15">{dict.detail.cardClickBadge}</span>
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
                    {fmt(dict.detail.sectionItemCount, { count: section.fields.length })}
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
                      repromptLocked={repromptLocked}
                      onRequireReprompt={focusRepromptPrompt}
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

        {/* Passkeys Section (Only rendered when passkeys exist) */}
        {item.passkeys.length > 0 && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                <Fingerprint size={14} className="text-sky-500" />
                {fmt(dict.detail.savedPasskeys, { count: item.passkeys.length })}
              </span>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
              {item.passkeys.map((pk) => {
                const isConfirming = confirmUnbindCredId === pk.credentialId;
                return (
                  <div key={pk.credentialId} className="p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            title={pk.rpName || pk.rpId}
                            className="text-[13px] font-semibold text-[var(--text-primary)] truncate"
                          >
                            {pk.rpName || pk.rpId}
                          </span>
                          {pk.rpId && pk.rpName && pk.rpName !== pk.rpId && (
                            <span
                              title={pk.rpId}
                              className="text-[11px] text-[var(--text-secondary)] truncate min-w-0"
                            >
                              ({pk.rpId})
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-sky-500/12 text-sky-600 dark:text-sky-400 text-[10px] font-mono-tabular font-medium shrink-0">
                            {pk.algorithm === -8 ? 'EdDSA' : pk.algorithm === -257 ? 'RS256' : 'ES256'}
                          </span>
                        </div>
                        <div
                          title={pk.userName || pk.userDisplayName}
                          className="text-xs text-[var(--text-secondary)] mt-0.5 truncate"
                        >
                          {pk.userName || pk.userDisplayName}
                        </div>
                        {pk.createdAt && (
                          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">
                            {formatDateTime(pk.createdAt)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                        {pk.rpId && (
                          <button
                            type="button"
                            onClick={() => void openExternalUrl(`https://${pk.rpId}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
                          >
                            <span>{dict.detail.manageOnSite}</span>
                            <ExternalLink size={12} />
                          </button>
                        )}
                        {!item.deletedAt && !isConfirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmUnbindCredId(pk.credentialId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-[var(--status-danger)]/10 border border-[var(--border-subtle)] text-xs font-medium text-[var(--status-danger)] cursor-pointer shrink-0"
                          >
                            <Trash2 size={12} />
                            {dict.common.remove}
                          </button>
                        )}
                      </div>
                    </div>

                    {isConfirming && (
                      <div className="p-3 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--text-primary)]">
                          {fmt(dict.detail.unbindPasskeyConfirm, { rpId: pk.rpId || 'website' })}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmUnbindCredId(null)}
                            className="px-2.5 py-1 rounded-md bg-[var(--bg-detail)] border border-[var(--border-strong)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                          >
                            {dict.common.cancel}
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
                                label: dict.sidebar.passkeys,
                                text: `${dict.common.remove}: ${pk.rpId || pk.rpName}`,
                                kind: 'warning',
                              });
                            }}
                            className="px-2.5 py-1 rounded-md bg-[var(--status-danger)] text-white text-[11px] font-medium cursor-pointer"
                          >
                            {dict.detail.confirmRemove}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[11px] min-w-0">
                      <span
                        title={pk.credentialId}
                        className="font-mono-tabular text-[var(--text-secondary)] truncate min-w-0 flex-1"
                      >
                        Credential ID: {pk.credentialId}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCopy(pk.credentialId, 'Credential ID', false)}
                        className="text-[var(--accent-primary)] hover:underline shrink-0 cursor-pointer"
                      >
                        {dict.detail.copyId}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
                      {u.label || dict.detail.urlDefaultLabel}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                      {dict.detail.matchRules[u.matchRule] ?? u.matchRule}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openExternalUrl(u.uri)}
                    className="block max-w-full text-left text-[13px] font-mono-tabular text-[var(--accent-primary)] hover:underline truncate mt-0.5 cursor-pointer"
                  >
                    {u.uri}
                  </button>
                </div>

                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCopy(u.uri, u.label || dict.detail.urlDefaultLabel, false)}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                    aria-label={dict.detail.copyUrlAria}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void openExternalUrl(u.uri)}
                    aria-label={dict.detail.openUrlAria}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notes */}
        {item.notes.trim() && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] px-4 py-3.5">
            <div className="text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">{dict.detail.notes}</div>
            <div data-selectable="true">{renderNotesLines(item.notes)}</div>
          </div>
        )}

        {/* Encrypted Attachments */}
        {!item.deletedAt && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <Paperclip size={13} />
                {fmt(dict.detail.attachments, { count: item.attachments?.length ?? 0 })}
              </span>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void handleAttachmentUpload(e)}
                />
                <button
                  type="button"
                  disabled={uploadingAtt}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[11px] font-medium text-[var(--text-primary)] cursor-pointer"
                >
                  <FileUp size={12} />
                  {uploadingAtt ? dict.detail.uploadingAttachment : dict.detail.uploadAttachment}
                </button>
              </div>
            </div>

            {(item.attachments?.length ?? 0) === 0 ? (
              <div className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                {dict.detail.attachmentsEmpty}
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {item.attachments?.map((att) => {
                  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(att.fileName);
                  return (
                    <div
                      key={att.id}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--text-primary)] truncate">{att.fileName}</div>
                        <div className="text-[10.5px] text-[var(--text-secondary)]">
                          {att.sizeName} · {att.hasLocalData ? dict.detail.attachmentCachedLocal : dict.detail.attachmentCloudOnly}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isImage && (
                          <button
                            type="button"
                            onClick={() => void handleAttachmentDownload(att.id, true)}
                            aria-label={fmt(dict.detail.previewAttachmentAria, { name: att.fileName })}
                            className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                          >
                            <ImageIcon size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleAttachmentDownload(att.id, false)}
                          aria-label={fmt(dict.detail.downloadAttachmentAria, { name: att.fileName })}
                          className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAttachmentDelete(att.id, att.fileName)}
                          aria-label={fmt(dict.detail.deleteAttachmentAria, { name: att.fileName })}
                          className="p-1.5 rounded-md hover:bg-[var(--status-danger)]/10 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {previewAtt && (
              <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-detail)] flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span>{fmt(dict.detail.imagePreviewTitle, { name: previewAtt.fileName })}</span>
                  <button
                    type="button"
                    onClick={() => setPreviewAtt(null)}
                    className="text-[var(--accent-primary)] hover:underline cursor-pointer"
                  >
                    {dict.detail.collapsePreviewBtn}
                  </button>
                </div>
                <img
                  src={`data:${previewAtt.mimeType};base64,${previewAtt.dataBase64}`}
                  alt={previewAtt.fileName}
                  className="max-h-60 object-contain rounded-lg border border-[var(--border-subtle)] bg-black/10"
                />
              </div>
            )}
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
                {fmt(dict.detail.passwordHistoryTitle, { count: item.passwordHistory.length })}
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
                          {fmt(dict.detail.archivedAtTime, { time: formatDateTime(hist.changedAt) })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setRevealedIds((p) => ({ ...p, [key]: !p[key] }))}
                          aria-label={isShown ? dict.detail.hideHistoryPwAria : dict.detail.showHistoryPwAria}
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                        >
                          {isShown ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopy(hist.value, dict.detail.historyPwLabel, true)}
                          aria-label={dict.detail.copyHistoryPwAria}
                          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer"
                        >
                          <Copy size={13} />
                        </button>
                        {passwordField && !repromptLocked && (
                          <button
                            type="button"
                            onClick={() => void handleRestorePassword(hist.value)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-selected)] text-[11px] font-medium text-[var(--accent-primary)] cursor-pointer"
                          >
                            <RotateCcw size={11} />
                            {dict.detail.restoreShort}
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
        <div className="pt-2 pb-4 flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
          <span>{fmt(dict.detail.updatedAt, { time: formatDateTime(item.updatedAt) })}</span>
          <span>{fmt(dict.detail.createdAt, { time: formatDateTime(item.createdAt) })}</span>
        </div>
      </div>

      {shareOrgOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Building2 size={15} className="text-[var(--accent-primary)]" />
                <span>{dict.detail.shareToOrg}</span>
              </div>
              <button
                type="button"
                onClick={() => setShareOrgOpen(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                {dict.detail.selectOrg}
              </label>
              <select
                value={selectedOrgId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedOrgId(nextId);
                  const found = orgs.find((o) => o.id === nextId);
                  setSelectedCollectionIds(
                    found && found.collections.length > 0 ? [found.collections[0].id] : [],
                  );
                }}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)]"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                {dict.detail.selectCollections}
              </label>
              <div className="max-h-36 overflow-y-auto flex flex-col gap-1 border border-[var(--border-subtle)] rounded-lg p-2 bg-[var(--bg-detail)]">
                {(orgs.find((o) => o.id === selectedOrgId)?.collections ?? []).map((col) => {
                  const checked = selectedCollectionIds.includes(col.id);
                  return (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedCollectionIds((prev) =>
                            e.target.checked
                              ? [...prev, col.id]
                              : prev.filter((id) => id !== col.id),
                          );
                        }}
                      />
                      <span className="truncate">{col.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShareOrgOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] cursor-pointer"
              >
                {dict.common.cancel}
              </button>
              <button
                type="button"
                disabled={sharingOrg || !selectedOrgId || selectedCollectionIds.length === 0}
                onClick={async () => {
                  setSharingOrg(true);
                  try {
                    await tauriClient.itemShareToOrganization(
                      item.id,
                      selectedOrgId,
                      selectedCollectionIds,
                    );
                    await refreshItems(getFilter());
                    await selectItem(item.id);
                    setShareOrgOpen(false);
                    showToast({
                      label: dict.detail.shareToOrg,
                      text: dict.detail.shareSuccess,
                      kind: 'info',
                    });
                  } catch (err) {
                    showToast({
                      label: dict.detail.shareToOrg,
                      text: err instanceof Error ? err.message : String(err),
                      kind: 'info',
                    });
                  } finally {
                    setSharingOrg(false);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-xs font-medium text-white cursor-pointer"
              >
                {dict.detail.shareConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
