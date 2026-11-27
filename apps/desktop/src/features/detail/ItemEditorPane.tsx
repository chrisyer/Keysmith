import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardPaste,
  Fingerprint,
  GripVertical,
  KeyRound,
  Link2,
  Lock,
  Palette,
  Plus,
  QrCode,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { GeneratorPopover } from '../../components/GeneratorPopover';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { useI18n } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';
import { TEMPLATE_MAP } from '../../services/templates';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { FieldType, ItemDraft, ItemField, UrlMatchRule } from '../../types/domain';
import { makeId } from '../../utils/format';

const ICON_COLOR_PRESETS = [
  '#0572EC',
  '#7C3AED',
  '#0D9488',
  '#16A34A',
  '#D97706',
  '#E11D48',
  '#4F46E5',
  '#475569',
];

const FIELD_TYPE_ORDER: FieldType[] = [
  'text',
  'password',
  'totp',
  'email',
  'url',
  'date',
  'month_year',
  'phone',
  'number',
  'multiline',
  'ssh_public_key',
  'ssh_private_key',
];

const URL_RULE_ORDER: UrlMatchRule[] = ['domain', 'host', 'starts_with', 'exact', 'never'];

interface ItemEditorPaneProps {
  initialDraft: ItemDraft;
  isNew: boolean;
}

export function ItemEditorPane({ initialDraft, isNew }: ItemEditorPaneProps) {
  const { dict, fmt } = useI18n();
  const iconPopUid = useId().replace(/:/g, '');
  const iconPopoverId = `icon-pop-${iconPopUid}`;
  const iconAnchorName = `--icon-btn-${iconPopUid}`;
  const iconPopoverRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<ItemDraft>(() => structuredClone(initialDraft));
  const [tagInput, setTagInput] = useState('');
  const [linkedSearch, setLinkedSearch] = useState('');
  const [domainIconHost, setDomainIconHost] = useState(
    initialDraft.icon?.kind === 'domain' ? initialDraft.icon.host : '',
  );
  const [saving, setSaving] = useState(false);
  const [sshGenerating, setSshGenerating] = useState(false);
  const [qrBusyFieldId, setQrBusyFieldId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ sectionId: string; fieldIndex: number } | null>(null);

  useEffect(() => {
    setDraft(structuredClone(initialDraft));
    setDomainIconHost(initialDraft.icon?.kind === 'domain' ? initialDraft.icon.host : '');
    setLinkedSearch('');
  }, [initialDraft]);

  const vaults = useVaultStore((s) => s.vaults);
  const allItems = useVaultStore((s) => s.items);
  const tagCounts = useVaultStore((s) => s.tagCounts);
  const createItem = useVaultStore((s) => s.createItem);
  const updateItem = useVaultStore((s) => s.updateItem);

  const getFilter = useUiStore((s) => s.getFilter);
  const stopEditing = useUiStore((s) => s.stopEditing);
  const showToast = useUiStore((s) => s.showToast);

  const tpl = TEMPLATE_MAP[draft.category] ?? TEMPLATE_MAP.login;

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      if (isNew || !draft.id) {
        await createItem(draft, getFilter());
        showToast({
          label: dict.editor.newItemLabel,
          text: fmt(dict.editor.newItemCreatedToast, {
            title: draft.title || dict.common.unnamedItem,
          }),
          kind: 'info',
        });
      } else {
        await updateItem(draft.id, draft, getFilter());
        showToast({
          label: dict.editor.saveItemLabel,
          text: fmt(dict.editor.saveItemUpdatedToast, { title: draft.title }),
          kind: 'info',
        });
      }
      stopEditing();
    } finally {
      setSaving(false);
    }
  };

  const updateField = (sectionId: string, fieldId: string, patch: Partial<ItemField>) => {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : {
              ...sec,
              fields: sec.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
            },
      ),
    }));
  };

  const moveField = (sectionId: string, fromIdx: number, toIdx: number) => {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((sec) => {
        if (sec.id !== sectionId) return sec;
        if (toIdx < 0 || toIdx >= sec.fields.length || fromIdx === toIdx) return sec;
        const copy = [...sec.fields];
        const [moved] = copy.splice(fromIdx, 1);
        copy.splice(toIdx, 0, moved);
        return { ...sec, fields: copy };
      }),
    }));
  };

  const addFieldToSection = (sectionId: string) => {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : {
              ...sec,
              fields: [
                ...sec.fields,
                {
                  id: makeId('f'),
                  label: dict.editor.customFieldDefault,
                  fieldType: 'text',
                  value: '',
                  sensitive: false,
                  copyable: true,
                },
              ],
            },
      ),
    }));
  };

  const removeField = (sectionId: string, fieldId: string) => {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : { ...sec, fields: sec.fields.filter((f) => f.id !== fieldId) },
      ),
    }));
  };

  const addSection = () => {
    setDraft((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: makeId('sec'),
          title: dict.editor.customSectionDefault,
          fields: [
            {
              id: makeId('f'),
              label: dict.editor.customSectionFieldDefault,
              fieldType: 'text',
              value: '',
              sensitive: false,
              copyable: true,
            },
          ],
        },
      ],
    }));
  };

  const addTag = (raw: string) => {
    const clean = raw.trim().replace(/^#/, '');
    if (!clean || draft.tags.includes(clean)) return;
    setDraft((p) => ({ ...p, tags: [...p.tags, clean] }));
    setTagInput('');
  };

  const handleGenerateSshKeypair = async (sectionId: string) => {
    setSshGenerating(true);
    try {
      const pair = await tauriClient.sshGenerateEd25519(draft.title || 'keysmith@local');
      setDraft((prev) => ({
        ...prev,
        sections: prev.sections.map((sec) => {
          if (sec.id !== sectionId) return sec;
          return {
            ...sec,
            fields: sec.fields.map((f) => {
              if (f.fieldType === 'ssh_public_key') return { ...f, value: pair.publicKey };
              if (f.fieldType === 'ssh_private_key') {
                return { ...f, value: pair.privateKeyOpenssh, sensitive: true };
              }
              if (
                f.label === dict.templates.fields.fingerprint ||
                f.label.includes('指纹') ||
                f.label.includes('指紋') ||
                f.label.toLowerCase().includes('fingerprint')
              ) {
                return { ...f, value: pair.fingerprintSha256 };
              }
              return f;
            }),
          };
        }),
      }));
      showToast({
        label: dict.editor.sshKeypairLabel,
        text: fmt(dict.editor.sshKeypairGeneratedToast, { fp: pair.fingerprintSha256 }),
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.editor.sshGenerateFailedLabel,
        text: err instanceof Error ? err.message : dict.editor.sshGenerateFailedText,
        kind: 'warning',
      });
    } finally {
      setSshGenerating(false);
    }
  };

  const handleTotpFromClipboard = async (sectionId: string, fieldId: string) => {
    setQrBusyFieldId(fieldId);
    try {
      const imgB64 = await tauriClient.clipboardReadImageBase64();
      if (!imgB64) {
        showToast({
          label: dict.editor.clipboardNoImageLabel,
          text: dict.editor.clipboardNoImageText,
          kind: 'warning',
        });
        return;
      }
      const otpUri = await tauriClient.totpParseQrImage(imgB64);
      updateField(sectionId, fieldId, { value: otpUri, sensitive: true });
      showToast({
        label: dict.editor.totpQrLabel,
        text: dict.editor.totpQrClipboardToast,
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.editor.qrParseFailedLabel,
        text: err instanceof Error ? err.message : dict.editor.qrParseFailedText,
        kind: 'warning',
      });
    } finally {
      setQrBusyFieldId(null);
    }
  };

  const handleTotpFromFile = async (
    sectionId: string,
    fieldId: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setQrBusyFieldId(fieldId);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error(dict.editor.imageReadFailed));
        reader.readAsDataURL(file);
      });
      const otpUri = await tauriClient.totpParseQrImage(base64);
      updateField(sectionId, fieldId, { value: otpUri, sensitive: true });
      showToast({
        label: dict.editor.totpQrLabel,
        text: fmt(dict.editor.totpQrFileToast, { name: file.name }),
        kind: 'info',
      });
    } catch (err) {
      showToast({
        label: dict.editor.qrParseFailedLabel,
        text: err instanceof Error ? err.message : dict.editor.qrParseFailedText,
        kind: 'warning',
      });
    } finally {
      setQrBusyFieldId(null);
    }
  };

  return (
    <form
      id="ks-item-editor-form"
      onSubmit={(e) => void handleSave(e)}
      className="h-full flex flex-col bg-[var(--bg-detail)] overflow-hidden"
    >
      {/* Sticky Editor Top Bar */}
      <header className="px-5 py-4 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 shrink-0 bg-[var(--bg-detail)]">
        <div className="flex items-center gap-3 min-w-[200px] flex-1">
          <button
            type="button"
            popoverTarget={iconPopoverId}
            style={{ anchorName: iconAnchorName } as React.CSSProperties}
            title={dict.editor.customIconTitle}
            className="relative group rounded-xl cursor-pointer shrink-0"
          >
            <ItemIconBadge icon={draft.icon} category={draft.category} title={draft.title} size="md" />
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-strong)] flex items-center justify-center text-[var(--text-secondary)]">
              <Palette size={9} />
            </span>
          </button>

          <div
            ref={iconPopoverRef}
            id={iconPopoverId}
            popover="auto"
            style={{ positionAnchor: iconAnchorName } as React.CSSProperties}
            className="ks-popover ks-anchored-popover w-[250px]"
          >
            <div className="p-3 flex flex-col gap-3 text-xs">
              <div className="font-semibold text-[var(--text-primary)]">{dict.editor.customIconTitle}</div>
              <div>
                <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">{dict.editor.presetBadgeColor}</div>
                <div className="flex flex-wrap gap-1.5">
                  {ICON_COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => {
                        setDraft((p) => ({
                          ...p,
                          icon: { kind: 'preset', name: tpl.iconName, color },
                        }));
                        iconPopoverRef.current?.hidePopover?.();
                      }}
                      className="w-6 h-6 rounded-lg border border-black/15 cursor-pointer"
                      style={{ backgroundColor: color }}
                      aria-label={fmt(dict.editor.pickColorAria, { color })}
                    />
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
                <div className="text-[11px] text-[var(--text-secondary)]">{dict.editor.orDomainFavicon}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={domainIconHost}
                    onChange={(e) => setDomainIconHost(e.target.value)}
                    placeholder="github.com"
                    className="flex-1 px-2 py-1 rounded-md bg-[var(--bg-input)] border border-[var(--border-strong)] text-xs font-mono-tabular text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cleanHost = domainIconHost.trim().replace(/^https?:\/\//i, '').split('/')[0];
                      if (!cleanHost) return;
                      setDraft((p) => ({ ...p, icon: { kind: 'domain', host: cleanHost } }));
                      iconPopoverRef.current?.hidePopover?.();
                    }}
                    className="px-2 py-1 rounded-md bg-[var(--accent-primary)] text-white text-[11px] cursor-pointer"
                  >
                    {dict.editor.applyBtn}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              placeholder={dict.editor.titlePlaceholder}
              required
              autoFocus
              className="w-full px-2.5 py-1 -mx-2.5 rounded-lg text-[17px] font-semibold bg-transparent hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-input)] border border-transparent focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none text-[var(--text-primary)] transition-colors"
            />
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] text-[var(--text-muted)]">{dict.categories[draft.category] ?? tpl.label}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <select
                value={draft.vaultId}
                onChange={(e) => setDraft((p) => ({ ...p, vaultId: e.target.value }))}
                aria-label={dict.editor.vaultSelectAria}
                className="ks-select-sm min-w-[84px] text-[var(--text-primary)]"
              >
                {vaults
                  .filter((v) => !v.isOrganization || v.id === draft.vaultId)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </select>
              <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer ml-1 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={Boolean(draft.archived)}
                  onChange={(e) => setDraft((p) => ({ ...p, archived: e.target.checked }))}
                  className="ks-checkbox"
                />
                <Archive size={11} />
                <span>{dict.editor.archivedCheckbox}</span>
              </label>
              <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer ml-1 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={Boolean(draft.reprompt)}
                  onChange={(e) => setDraft((p) => ({ ...p, reprompt: e.target.checked }))}
                  className="ks-checkbox"
                />
                <Lock size={11} />
                <span>{dict.editor.repromptLabel}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          <button
            type="button"
            onClick={stopEditing}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] cursor-pointer"
          >
            {dict.editor.cancel}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white shadow-xs cursor-pointer"
          >
            <Check size={14} />
            {saving ? dict.editor.saving : dict.editor.saveWithShortcut}
          </button>
        </div>
      </header>

      {/* Scrollable Editor Body */}
      <div className="flex-1 min-h-0 overflow-y-auto ks-scroll px-7 py-5 space-y-5">
        {draft.sections.map((section, sIdx) => (
          <div
            key={section.id}
            className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              {sIdx === 0 && !section.title ? (
                <span className="text-xs font-semibold text-[var(--text-secondary)]">{dict.editor.sectionMainFields}</span>
              ) : (
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      sections: prev.sections.map((s) =>
                        s.id === section.id ? { ...s, title: e.target.value } : s,
                      ),
                    }))
                  }
                  placeholder={dict.editor.sectionTitlePlaceholder}
                  className="text-xs font-semibold bg-transparent border-b border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-[var(--text-primary)] pb-0.5"
                />
              )}

              {sIdx > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      sections: prev.sections.filter((s) => s.id !== section.id),
                    }))
                  }
                  aria-label={dict.editor.removeSectionAria}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                >
                  {dict.editor.removeSectionBtn}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              {section.fields.map((field, fIdx) => {
                const isSecret = field.sensitive || field.fieldType === 'password' || field.fieldType === 'totp' || field.fieldType === 'ssh_private_key';
                const isMultiline = field.fieldType === 'multiline' || field.fieldType === 'ssh_private_key' || field.fieldType === 'ssh_public_key';

                return (
                  <div
                    key={field.id}
                    draggable
                    onDragStart={() => setDragInfo({ sectionId: section.id, fieldIndex: fIdx })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragInfo && dragInfo.sectionId === section.id) {
                        moveField(section.id, dragInfo.fieldIndex, fIdx);
                      }
                      setDragInfo(null);
                    }}
                    className="p-3 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                        <span className="cursor-grab text-[var(--text-muted)] shrink-0" title={dict.editor.dragSortTitle}>
                          <GripVertical size={14} />
                        </span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(section.id, field.id, { label: e.target.value })}
                          placeholder={dict.editor.fieldLabelPlaceholder}
                          className="px-1.5 py-0.5 rounded text-xs font-medium bg-transparent hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-input)] border border-transparent focus:border-[var(--accent-primary)] focus:outline-none text-[var(--text-secondary)] flex-1 min-w-[72px] transition-colors"
                        />
                        <select
                          value={field.fieldType}
                          onChange={(e) => {
                            const nextType = e.target.value as FieldType;
                            const autoSensitive =
                              nextType === 'password' ||
                              nextType === 'totp' ||
                              nextType === 'ssh_private_key';
                            updateField(section.id, field.id, {
                              fieldType: nextType,
                              sensitive: autoSensitive ? true : field.sensitive,
                            });
                          }}
                          aria-label={dict.editor.fieldTypeAria}
                          className="ks-select-sm min-w-[96px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap"
                        >
                          {FIELD_TYPE_ORDER.map((ft) => (
                            <option key={ft} value={ft}>
                              {dict.editor.fieldTypes[ft as keyof typeof dict.editor.fieldTypes] ?? ft}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
                        <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] cursor-pointer mr-1 whitespace-nowrap shrink-0">
                          <input
                            type="checkbox"
                            checked={field.sensitive}
                            onChange={(e) =>
                              updateField(section.id, field.id, { sensitive: e.target.checked })
                            }
                            className="ks-checkbox"
                          />
                          {dict.editor.sensitiveCheckbox}
                        </label>
                        <button
                          type="button"
                          onClick={() => moveField(section.id, fIdx, fIdx - 1)}
                          disabled={fIdx === 0}
                          aria-label={dict.editor.moveFieldUpAria}
                          className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 text-[var(--text-muted)] cursor-pointer"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(section.id, fIdx, fIdx + 1)}
                          disabled={fIdx === section.fields.length - 1}
                          aria-label={dict.editor.moveFieldDownAria}
                          className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 text-[var(--text-muted)] cursor-pointer"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(section.id, field.id)}
                          aria-label={dict.editor.removeFieldAria}
                          className="p-1 rounded hover:bg-[var(--status-danger)]/10 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isMultiline ? (
                        <textarea
                          rows={3}
                          value={field.value}
                          onChange={(e) => updateField(section.id, field.id, { value: e.target.value })}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          placeholder={dict.editor.multilinePlaceholder}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none text-xs font-mono-tabular text-[var(--text-primary)] transition-colors"
                        />
                      ) : (
                        <input
                          type="text"
                          value={field.value}
                          onChange={(e) => updateField(section.id, field.id, { value: e.target.value })}
                          autoComplete={isSecret ? 'off' : undefined}
                          autoCorrect={isSecret ? 'off' : undefined}
                          autoCapitalize={isSecret ? 'off' : undefined}
                          spellCheck={isSecret ? false : undefined}
                          placeholder={
                            field.fieldType === 'totp'
                              ? dict.editor.totpValuePlaceholder
                              : dict.editor.fieldValuePlaceholder
                          }
                          className={`ks-input w-full focus:ring-2 focus:ring-[var(--accent-primary)]/20 text-[13px] ${
                            isSecret ? 'font-mono-tabular' : ''
                          }`}
                        />
                      )}

                      {field.fieldType === 'password' && (
                        <GeneratorPopover
                          onUsePassword={(generated) =>
                            updateField(section.id, field.id, { value: generated })
                          }
                        />
                      )}
                    </div>

                    {field.fieldType === 'totp' && (
                      <div className="flex items-center flex-wrap gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={qrBusyFieldId === field.id}
                          onClick={() => void handleTotpFromClipboard(section.id, field.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                        >
                          <ClipboardPaste size={11} />
                          {qrBusyFieldId === field.id ? dict.editor.qrRecognizing : dict.editor.importQrClipboard}
                        </button>
                        <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer">
                          <QrCode size={11} />
                          <span>{dict.editor.uploadQrImage}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => void handleTotpFromFile(section.id, field.id, e)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center flex-wrap gap-3">
              <button
                type="button"
                onClick={() => addFieldToSection(section.id)}
                className="self-start inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
              >
                <Plus size={13} />
                {dict.editor.addField}
              </button>

              {(draft.category === 'ssh_key' ||
                section.fields.some(
                  (f) => f.fieldType === 'ssh_private_key' || f.fieldType === 'ssh_public_key',
                )) && (
                <button
                  type="button"
                  disabled={sshGenerating}
                  onClick={() => void handleGenerateSshKeypair(section.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-detail)] hover:bg-[var(--bg-selected)] border border-[var(--border-strong)] text-xs font-medium text-[var(--accent-primary)] cursor-pointer"
                >
                  <KeyRound size={12} />
                  {sshGenerating ? dict.editor.generatingEd25519 : dict.editor.generateEd25519}
                </button>
              )}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addSection}
          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-strong)] hover:border-[var(--accent-primary)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
        >
          <Plus size={13} />
          {dict.editor.addSection}
        </button>

        {/* Passkeys Bound List */}
        {draft.passkeys.length > 0 && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
              <Fingerprint size={14} className="text-sky-500" />
              {fmt(dict.editor.boundPasskeys, { count: draft.passkeys.length })}
            </span>
            <div className="flex flex-col gap-2">
              {draft.passkeys.map((pk) => (
                <div
                  key={pk.credentialId}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs min-w-0"
                >
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div
                      title={`${pk.rpName} (${pk.rpId}) · ${pk.userName}`}
                      className="font-medium text-[var(--text-primary)] truncate"
                    >
                      {pk.rpName} ({pk.rpId}) · {pk.userName}
                    </div>
                    <div
                      title={pk.credentialId}
                      className="text-[11px] text-[var(--text-muted)] font-mono-tabular truncate"
                    >
                      {pk.credentialId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        passkeys: p.passkeys.filter((x) => x.credentialId !== pk.credentialId),
                      }))
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--status-danger)]/10 text-[11px] text-[var(--status-danger)] shrink-0 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    {dict.editor.unbindPasskey}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* URLs Editor */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{dict.editor.relatedUrls}</span>
            <button
              type="button"
              onClick={() =>
                setDraft((p) => ({
                  ...p,
                  urls: [...p.urls, { id: makeId('u'), uri: '', label: dict.editor.defaultUrlLabel, matchRule: 'domain' }],
                }))
              }
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              <Plus size={13} />
              {dict.editor.addUrl}
            </button>
          </div>

          {draft.urls.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">{dict.editor.noUrls}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {draft.urls.map((u) => (
                <div key={u.id} className="flex items-center gap-2">
                  <input
                    type="url"
                    value={u.uri}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        urls: p.urls.map((x) => (x.id === u.id ? { ...x, uri: e.target.value } : x)),
                      }))
                    }
                    placeholder="https://example.com"
                    className="ks-input flex-1 font-mono-tabular focus:ring-2 focus:ring-[var(--accent-primary)]/20"
                  />
                  <select
                    value={u.matchRule}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        urls: p.urls.map((x) =>
                          x.id === u.id ? { ...x, matchRule: e.target.value as UrlMatchRule } : x,
                        ),
                      }))
                    }
                    aria-label={dict.editor.urlMatchRuleAria}
                    className="ks-select min-w-[124px] text-[var(--text-secondary)] shrink-0"
                  >
                    {URL_RULE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {dict.editor.urlRules[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({ ...p, urls: p.urls.filter((x) => x.id !== u.id) }))
                    }
                    aria-label={dict.editor.removeUrlAria}
                    className="p-1.5 rounded hover:bg-[var(--status-danger)]/10 text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tags Editor */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">{dict.editor.tagsLabel}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-selected)] text-xs font-medium text-[var(--accent-primary)]"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() =>
                    setDraft((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) }))
                  }
                  aria-label={fmt(dict.editor.removeTagAria, { tag })}
                  className="hover:text-[var(--status-danger)] cursor-pointer"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder={dict.editor.tagInputPlaceholder}
              className="px-2 py-1 text-xs bg-transparent focus:outline-none text-[var(--text-primary)] min-w-[140px]"
            />
          </div>
          {tagCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[11px] text-[var(--text-muted)] mr-1">{dict.editor.commonTags}</span>
              {tagCounts
                .filter((t) => !draft.tags.includes(t.tag))
                .slice(0, 6)
                .map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => addTag(t.tag)}
                    className="px-2 py-0.5 rounded bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
                  >
                    + {t.tag}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* SSO Provider (Login items) */}
        {draft.category === 'login' && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2.5">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              {dict.editor.ssoProviderLabel}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(['', 'Google', 'Apple', 'GitHub', 'Microsoft', 'GitLab', 'Okta', 'WeChat'] as const).map(
                (prov) => {
                  const active = (draft.ssoProvider ?? '') === prov;
                  return (
                    <button
                      key={prov || 'none'}
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({ ...p, ssoProvider: prov || undefined }))
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs border cursor-pointer ${
                        active
                          ? 'bg-[var(--bg-selected)] border-[var(--accent-primary)] text-[var(--accent-primary)] font-medium'
                          : 'bg-[var(--bg-detail)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {prov || dict.editor.ssoProviderNone}
                    </button>
                  );
                },
              )}
            </div>
            <input
              type="text"
              value={draft.ssoProvider ?? ''}
              onChange={(e) =>
                setDraft((p) => ({ ...p, ssoProvider: e.target.value || undefined }))
              }
              placeholder={dict.editor.ssoProviderCustomPlaceholder}
              className="ks-input w-full text-xs"
            />
          </div>
        )}

        {/* Linked Items */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
            <Link2 size={13} />
            {dict.editor.linkedItemsLabel}
          </span>
          {(draft.linkedItemIds ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(draft.linkedItemIds ?? []).map((lid) => {
                const target = allItems.find((it) => it.id === lid);
                return (
                  <span
                    key={lid}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-selected)] text-xs font-medium text-[var(--accent-primary)]"
                  >
                    <span>{target?.title ?? lid.slice(0, 8)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          linkedItemIds: (p.linkedItemIds ?? []).filter((x) => x !== lid),
                        }))
                      }
                      className="hover:text-[var(--status-danger)] cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <input
            type="text"
            value={linkedSearch}
            onChange={(e) => setLinkedSearch(e.target.value)}
            placeholder={dict.editor.linkedItemsSearchPlaceholder}
            className="ks-input w-full text-xs"
          />
          {linkedSearch.trim() && (
            <div className="max-h-36 overflow-y-auto ks-scroll flex flex-col gap-1 pt-0.5">
              {allItems
                .filter(
                  (it) =>
                    !it.deletedAt &&
                    it.id !== draft.id &&
                    !(draft.linkedItemIds ?? []).includes(it.id) &&
                    (it.title.toLowerCase().includes(linkedSearch.trim().toLowerCase()) ||
                      it.subtitle.toLowerCase().includes(linkedSearch.trim().toLowerCase())),
                )
                .slice(0, 8)
                .map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      setDraft((p) => ({
                        ...p,
                        linkedItemIds: [...(p.linkedItemIds ?? []), it.id],
                      }));
                      setLinkedSearch('');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] flex items-center justify-between text-xs text-left cursor-pointer"
                  >
                    <span className="font-medium text-[var(--text-primary)] truncate">{it.title}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0 ml-2">
                      {dict.categories[it.category] ?? it.category}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Notes Editor */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2">
          <label htmlFor="editor-notes" className="text-xs font-semibold text-[var(--text-secondary)]">
            {dict.editor.notesLabel}
          </label>
          <textarea
            id="editor-notes"
            rows={4}
            value={draft.notes}
            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            placeholder={dict.editor.notesPlaceholder}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none text-xs leading-relaxed text-[var(--text-primary)] transition-colors"
          />
        </div>
      </div>
    </form>
  );
}
