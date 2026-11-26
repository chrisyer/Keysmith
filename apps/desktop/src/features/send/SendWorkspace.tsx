import {
  Check,
  Copy,
  ExternalLink,
  FileUp,
  Flame,
  Lock,
  Plus,
  Send,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';
import { useUiStore } from '../../stores/uiStore';
import { countActiveSends, useVaultStore } from '../../stores/vaultStore';
import type { SendItem, SendType } from '../../types/domain';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { openExternalUrl } from '../../utils/opener';

type PresetHours = 1 | 24 | 168 | 336 | 720;

function futureIsoFromHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function isoToLocalDatetimeInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeInputToIso(val: string): string | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function sendStatus(
  item: SendItem,
  dict: ReturnType<typeof useI18n>['dict'],
): { label: string; tone: 'success' | 'danger' | 'warning' } {
  if (item.disabled) {
    return { label: dict.send.statusDisabled, tone: 'danger' };
  }
  const now = Date.now();
  if (item.expirationDate && Date.parse(item.expirationDate) <= now) {
    return { label: dict.send.statusExpired, tone: 'warning' };
  }
  if (item.deletionDate && Date.parse(item.deletionDate) <= now) {
    return { label: dict.send.statusExpired, tone: 'warning' };
  }
  if (item.maxAccessCount !== null && item.accessCount >= item.maxAccessCount) {
    return { label: dict.send.statusLimitReached, tone: 'warning' };
  }
  return { label: dict.send.statusActive, tone: 'success' };
}

export function SendWorkspace() {
  const { dict, fmt } = useI18n();
  const showToast = useUiStore((s) => s.showToast);
  const sendPrefill = useUiStore((s) => s.sendPrefill);
  const clearSendPrefill = useUiStore((s) => s.clearSendPrefill);

  const [sends, setSends] = useState<SendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | SendType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Shared Create/Edit Form State
  const [formType, setFormType] = useState<SendType>('text');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState(true);
  const [notes, setNotes] = useState('');
  const [deletionHours, setDeletionHours] = useState<PresetHours>(168);
  const [expirationHours, setExpirationHours] = useState<PresetHours | 0>(0);
  const [editDeletionDate, setEditDeletionDate] = useState('');
  const [editExpirationDate, setEditExpirationDate] = useState('');
  const [maxAccessCount, setMaxAccessCount] = useState<string>('');
  const [password, setPassword] = useState('');
  const [hideEmail, setHideEmail] = useState(true);
  const [disabled, setDisabled] = useState(false);

  // File create state
  const [selectedFile, setSelectedFile] = useState<{
    fileName: string;
    size: number;
    base64: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setSendCount = useVaultStore((s) => s.setSendCount);

  const loadSends = useCallback(async () => {
    setLoading(true);
    try {
      const list = await tauriClient.sendList();
      setSends(list);
      setSendCount(countActiveSends(list));
      setSelectedId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch {
      setSends([]);
      setSendCount(0);
    } finally {
      setLoading(false);
    }
  }, [setSendCount]);

  useEffect(() => {
    void loadSends();
  }, [loadSends]);

  const startCreate = useCallback(
    (prefill?: { name: string; text: string }) => {
      setIsCreating(true);
      setSelectedId(null);
      setConfirmDelete(false);
      setFormType('text');
      setName(prefill?.name ?? '');
      setText(prefill?.text ?? '');
      setHidden(true);
      setNotes('');
      setDeletionHours(prefill ? 24 : 168);
      setExpirationHours(0);
      setMaxAccessCount(prefill ? '1' : '');
      setPassword('');
      setHideEmail(true);
      setDisabled(false);
      setSelectedFile(null);
    },
    [],
  );

  useEffect(() => {
    if (sendPrefill) {
      startCreate({
        name: sendPrefill.name,
        text: sendPrefill.text,
      });
      clearSendPrefill();
    }
  }, [sendPrefill, clearSendPrefill, startCreate]);

  const selectedSend = isCreating ? null : sends.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedSend) return;
    setConfirmDelete(false);
    setFormType(selectedSend.sendType);
    setName(selectedSend.name);
    setText(selectedSend.text ?? '');
    setHidden(selectedSend.hidden);
    setNotes(selectedSend.notes ?? '');
    setMaxAccessCount(
      selectedSend.maxAccessCount !== null && selectedSend.maxAccessCount !== undefined
        ? String(selectedSend.maxAccessCount)
        : '',
    );
    setEditDeletionDate(isoToLocalDatetimeInput(selectedSend.deletionDate));
    setEditExpirationDate(isoToLocalDatetimeInput(selectedSend.expirationDate));
    setPassword('');
    setHideEmail(selectedSend.hideEmail);
    setDisabled(selectedSend.disabled);
  }, [selectedSend]);

  const filteredSends = sends.filter((s) => typeFilter === 'all' || s.sendType === typeFilter);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast({ label: 'Send', text: dict.send.fileTooLargeToast, kind: 'warning' });
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result ?? '');
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = () => reject(new Error(dict.send.readFileFailed));
      reader.readAsDataURL(file);
    });
    setSelectedFile({ fileName: file.name, size: file.size, base64 });
    if (!name.trim()) {
      setName(file.name);
    }
  };

  const handleCopyShareLink = async (item: SendItem) => {
    if (!item.shareUrl) return;
    await tauriClient.clipboardCopySecret(item.shareUrl, item.name, false);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    showToast({ label: 'Send', text: dict.send.copiedLink, kind: 'info' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMax = maxAccessCount.trim();
    const parsedMax = trimmedMax ? Math.max(1, Number.parseInt(trimmedMax, 10) || 1) : null;
    const trimmedPassword = password.trim() || undefined;

    setSaving(true);
    try {
      if (isCreating) {
        const deletionDate = futureIsoFromHours(deletionHours);
        const expirationDate = expirationHours > 0 ? futureIsoFromHours(expirationHours) : undefined;
        let created: SendItem;
        if (formType === 'file') {
          if (!selectedFile) {
            showToast({ label: 'Send', text: dict.send.chooseFile, kind: 'warning' });
            return;
          }
          created = await tauriClient.sendCreateFile({
            name: name.trim(),
            fileName: selectedFile.fileName,
            dataBase64: selectedFile.base64,
            notes: notes.trim() || undefined,
            maxAccessCount: parsedMax,
            expirationDate,
            deletionDate,
            password: trimmedPassword,
            disabled,
            hideEmail,
          });
        } else {
          created = await tauriClient.sendCreateText({
            name: name.trim(),
            text,
            hidden,
            notes: notes.trim() || undefined,
            maxAccessCount: parsedMax,
            expirationDate,
            deletionDate,
            password: trimmedPassword,
            disabled,
            hideEmail,
          });
        }
        setIsCreating(false);
        const nextList = [created, ...sends.filter((x) => x.id !== created.id)];
        setSends(nextList);
        setSendCount(countActiveSends(nextList));
        setSelectedId(created.id);
        if (created.shareUrl) {
          await tauriClient.clipboardCopySecret(created.shareUrl, created.name, false);
        }
        showToast({ label: 'Send', text: dict.send.createdToast, kind: 'info' });
      } else if (selectedSend) {
        const nextDeletionIso =
          localDatetimeInputToIso(editDeletionDate) ?? selectedSend.deletionDate;
        const nextExpirationIso = editExpirationDate
          ? localDatetimeInputToIso(editExpirationDate)
          : undefined;
        const updated = await tauriClient.sendUpdate(selectedSend.id, {
          name: name.trim(),
          text: selectedSend.sendType === 'text' ? text : undefined,
          hidden: selectedSend.sendType === 'text' ? hidden : undefined,
          notes: notes.trim() || undefined,
          maxAccessCount: parsedMax,
          expirationDate: nextExpirationIso,
          deletionDate: nextDeletionIso,
          password: trimmedPassword,
          disabled,
          hideEmail,
        });
        setPassword('');
        const nextList = sends.map((x) => (x.id === updated.id ? updated : x));
        setSends(nextList);
        setSendCount(countActiveSends(nextList));
        showToast({ label: 'Send', text: dict.send.updatedToast, kind: 'info' });
      }
    } catch (err) {
      showToast({
        label: 'Send',
        text: err instanceof Error ? err.message : dict.send.operationFailed,
        kind: 'warning',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!selectedSend) return;
    setSaving(true);
    try {
      const updated = await tauriClient.sendRemovePassword(selectedSend.id);
      const nextList = sends.map((x) => (x.id === updated.id ? updated : x));
      setSends(nextList);
      setSendCount(countActiveSends(nextList));
      showToast({ label: 'Send', text: dict.send.passwordRemovedToast, kind: 'info' });
    } catch (err) {
      showToast({
        label: 'Send',
        text: err instanceof Error ? err.message : dict.send.removePasswordFailed,
        kind: 'warning',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSend) return;
    setSaving(true);
    try {
      await tauriClient.sendDelete(selectedSend.id);
      const nextList = sends.filter((s) => s.id !== selectedSend.id);
      setSends(nextList);
      setSendCount(countActiveSends(nextList));
      setSelectedId(nextList[0]?.id ?? null);
      setConfirmDelete(false);
      showToast({ label: 'Send', text: dict.send.deletedToast, kind: 'info' });
    } catch (err) {
      showToast({
        label: 'Send',
        text: err instanceof Error ? err.message : dict.send.deleteFailed,
        kind: 'warning',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex-1 flex bg-[var(--bg-detail)] overflow-hidden">
      {/* Send List Column */}
      <section className="w-[300px] shrink-0 h-full border-r border-[var(--border-subtle)] bg-[var(--bg-list)] flex flex-col overflow-hidden">
        <div className="p-3 border-b border-[var(--border-subtle)] flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Send size={15} className="text-[var(--accent-primary)] shrink-0" />
              <h1 className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                {dict.send.title}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => startCreate()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer shrink-0"
            >
              <Plus size={13} />
              {dict.send.newBtn}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[11px]">
            {(
              [
                { id: 'all', label: dict.send.filterAll },
                { id: 'text', label: dict.send.typeText },
                { id: 'file', label: dict.send.typeFile },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id)}
                className={`py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  typeFilter === tab.id
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto ks-scroll p-2 flex flex-col gap-1">
          {loading ? (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              {dict.app.initializing}
            </div>
          ) : filteredSends.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center gap-1.5">
              <Send size={22} className="text-[var(--text-muted)] opacity-50 mb-1" />
              <div className="text-xs font-medium text-[var(--text-secondary)]">
                {dict.send.emptyTitle}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                {dict.send.emptyHint}
              </div>
            </div>
          ) : (
            filteredSends.map((s) => {
              const active = !isCreating && s.id === selectedId;
              const status = sendStatus(s, dict);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setSelectedId(s.id);
                  }}
                  className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer flex flex-col gap-1 ${
                    active
                      ? 'bg-[var(--bg-selected)] ring-1 ring-[var(--accent-primary)]/35'
                      : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {s.name}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] shrink-0">
                      {s.sendType === 'file' ? dict.send.typeFile : dict.send.typeText}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-[var(--text-muted)]">
                    <span className="truncate">
                      {s.maxAccessCount !== null
                        ? fmt(dict.send.accessStat, { used: s.accessCount, max: s.maxAccessCount })
                        : fmt(dict.send.accessUnlimited, { used: s.accessCount })}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.hasPassword && <Lock size={10} className="text-[var(--text-secondary)]" />}
                      <span
                        className={
                          status.tone === 'success'
                            ? 'text-[var(--status-success)]'
                            : status.tone === 'danger'
                              ? 'text-[var(--status-danger)]'
                              : 'text-[var(--status-warning)]'
                        }
                      >
                        {status.label}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Send Detail / Create Form */}
      <main className="flex-1 min-w-0 h-full overflow-y-auto ks-scroll px-7 py-6">
        {!isCreating && !selectedSend ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)] mb-3">
              <Send size={22} />
            </div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {dict.send.title}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
              {dict.send.subtitle}
            </p>
            <button
              type="button"
              onClick={() => startCreate()}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              <Plus size={14} />
              {dict.send.newBtn}
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="max-w-2xl mx-auto flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {isCreating
                    ? formType === 'file'
                      ? dict.send.newFileTitle
                      : dict.send.newTextTitle
                    : selectedSend?.name}
                </h2>
                {!isCreating && selectedSend && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {formatRelativeTime(selectedSend.revisionDate)} · Delete:{' '}
                    {formatDateTime(selectedSend.deletionDate)}
                  </p>
                )}
              </div>

              {isCreating && (
                <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs">
                  <button
                    type="button"
                    onClick={() => setFormType('text')}
                    className={`px-3 py-1 rounded-md font-medium cursor-pointer ${
                      formType === 'text'
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {dict.send.typeText}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormType('file')}
                    className={`px-3 py-1 rounded-md font-medium cursor-pointer ${
                      formType === 'file'
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {dict.send.typeFile}
                  </button>
                </div>
              )}
            </div>

            {/* Share URL Card when editing existing Send */}
            {!isCreating && selectedSend && selectedSend.shareUrl && (
              <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-2">
                <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {dict.send.shareUrlLabel}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={selectedSend.shareUrl}
                    className="ks-input flex-1 font-mono-tabular select-all"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyShareLink(selectedSend)}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer shrink-0"
                  >
                    {copiedId === selectedSend.id ? <Check size={13} /> : <Copy size={13} />}
                    {copiedId === selectedSend.id ? dict.send.copiedLink : dict.send.copyLink}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openExternalUrl(selectedSend.shareUrl)}
                    title={dict.send.openLink}
                    aria-label={dict.send.openLink}
                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center p-2 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer shrink-0"
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Core Fields */}
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {dict.send.nameLabel}
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={dict.send.namePlaceholder}
                  className="ks-input w-full"
                />
              </label>

              {formType === 'text' ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {dict.send.textLabel}
                    </span>
                    <textarea
                      required
                      rows={5}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={dict.send.textPlaceholder}
                      className="px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none font-mono-tabular text-xs text-[var(--text-primary)] resize-y"
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hidden}
                      onChange={(e) => setHidden(e.target.checked)}
                      className="ks-checkbox"
                    />
                    <span>{dict.send.hiddenTextLabel}</span>
                  </label>
                </>
              ) : isCreating ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    {dict.send.fileLabel}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => void handleFileChange(e)}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-medium text-[var(--text-primary)] cursor-pointer"
                    >
                      <FileUp size={13} />
                      {dict.send.chooseFile}
                    </button>
                    {selectedFile && (
                      <span className="text-xs text-[var(--text-secondary)] truncate">
                        {selectedFile.fileName} ({Math.max(1, Math.round(selectedFile.size / 1024))} KB)
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
                  {selectedSend?.fileName} · {selectedSend?.fileSizeName ?? ''}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {dict.send.notesLabel}
                </span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-xs text-[var(--text-primary)] resize-none"
                />
              </label>
            </div>

            {/* Access & Lifecycle Controls */}
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col gap-3.5 text-xs">
              {isCreating ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {dict.send.deletionLabel}
                    </span>
                    <select
                      value={deletionHours}
                      onChange={(e) => setDeletionHours(Number(e.target.value) as PresetHours)}
                      className="ks-select w-full"
                    >
                      <option value={1}>{dict.send.preset1h}</option>
                      <option value={24}>{dict.send.preset1d}</option>
                      <option value={168}>{dict.send.preset7d}</option>
                      <option value={336}>{dict.send.preset14d}</option>
                      <option value={720}>{dict.send.preset30d}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {dict.send.expirationLabel}
                    </span>
                    <select
                      value={expirationHours}
                      onChange={(e) => setExpirationHours(Number(e.target.value) as PresetHours | 0)}
                      className="ks-select w-full"
                    >
                      <option value={0}>{dict.send.noExpiration}</option>
                      <option value={1}>{dict.send.preset1h}</option>
                      <option value={24}>{dict.send.preset1d}</option>
                      <option value={168}>{dict.send.preset7d}</option>
                      <option value={336}>{dict.send.preset14d}</option>
                    </select>
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {dict.send.deletionLabel}
                    </span>
                    <input
                      type="datetime-local"
                      required
                      value={editDeletionDate}
                      onChange={(e) => setEditDeletionDate(e.target.value)}
                      className="ks-input w-full font-mono-tabular"
                    />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      {dict.send.expirationLabel}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="datetime-local"
                        value={editExpirationDate}
                        onChange={(e) => setEditExpirationDate(e.target.value)}
                        className="ks-input flex-1 font-mono-tabular min-w-0"
                      />
                      {editExpirationDate && (
                        <button
                          type="button"
                          onClick={() => setEditExpirationDate('')}
                          className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] cursor-pointer shrink-0"
                        >
                          {dict.send.clearExpiration}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    {dict.send.maxAccessLabel}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={maxAccessCount}
                      onChange={(e) => setMaxAccessCount(e.target.value)}
                      placeholder="∞"
                      className="ks-input flex-1 font-mono-tabular min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => setMaxAccessCount('1')}
                      className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] cursor-pointer shrink-0"
                    >
                      <Flame size={11} className="text-amber-500" />
                      {dict.send.oneTimePreset}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    {dict.send.passwordLabel}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={dict.send.passwordPlaceholder}
                      className="ks-input flex-1 min-w-0"
                    />
                    {!isCreating && selectedSend?.hasPassword && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRemovePassword()}
                        className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--status-warning)]/40 text-[11px] text-[var(--status-warning)] hover:bg-[var(--status-warning)]/10 cursor-pointer shrink-0"
                      >
                        <ShieldOff size={11} />
                        {dict.send.removePassword}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1">
                <label className="inline-flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideEmail}
                    onChange={(e) => setHideEmail(e.target.checked)}
                    className="ks-checkbox"
                  />
                  <span>{dict.send.hideEmailLabel}</span>
                </label>

                <label className="inline-flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disabled}
                    onChange={(e) => setDisabled(e.target.checked)}
                    className="ks-checkbox"
                  />
                  <span>{dict.send.disabledLabel}</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              {!isCreating && selectedSend ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDelete()}
                      className="px-3 py-1.5 rounded-lg bg-[var(--status-danger)] text-xs font-medium text-white cursor-pointer"
                    >
                      {dict.send.confirmDeleteBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] cursor-pointer"
                    >
                      {dict.common.cancel}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--status-danger)]/40 text-xs font-medium text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    {dict.send.deleteBtn}
                  </button>
                )
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                {isCreating && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setSelectedId(sends[0]?.id ?? null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    {dict.common.cancel}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white shadow-xs cursor-pointer"
                >
                  <Check size={14} />
                  {saving
                    ? dict.send.savingBtn
                    : isCreating
                      ? dict.send.createBtn
                      : dict.send.saveBtn}
                </button>
              </div>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
