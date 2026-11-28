import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Fingerprint,
  Globe,
  GripVertical,
  KeyRound,
  Link2,
  Lock,
  Mail,
  Palette,
  Phone,
  Plus,
  QrCode,
  ScanLine,
  ShieldAlert,
  Trash2,
  Type,
  User,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GeneratorPopover } from '../../components/GeneratorPopover';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { isCustomWindowChrome } from '../../components/WindowChrome';
import { useI18n, type Dictionary } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';
import { TEMPLATE_MAP } from '../../services/templates';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type {
  FieldPurpose,
  FieldType,
  ItemDraft,
  ItemField,
  UrlMatchRule,
} from '../../types/domain';
import { makeId } from '../../utils/format';
import { formatShortcut } from '../../utils/shortcuts';

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

interface CommonFieldPreset {
  id: string;
  label: string;
  fieldType: FieldType;
  sensitive: boolean;
  purpose?: FieldPurpose;
  icon: React.ReactNode;
}

function defaultLabelForFieldType(ft: FieldType, dict: Dictionary): string {
  if (ft === 'totp') return dict.editor.presetTotp;
  if (ft === 'password') return dict.templates.fields.password;
  if (ft === 'url') return dict.templates.urls.website;
  return dict.editor.fieldTypes[ft as keyof typeof dict.editor.fieldTypes] ?? ft;
}

function getCommonFieldPresets(dict: Dictionary): CommonFieldPreset[] {
  return [
    {
      id: 'totp',
      label: dict.editor.presetTotp,
      fieldType: 'totp',
      sensitive: true,
      purpose: 'totp',
      icon: <Clock size={13} className="text-[var(--accent-primary)] shrink-0" />,
    },
    {
      id: 'password',
      label: dict.templates.fields.password,
      fieldType: 'password',
      sensitive: true,
      purpose: 'password',
      icon: <KeyRound size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'username',
      label: dict.templates.fields.username,
      fieldType: 'text',
      sensitive: false,
      purpose: 'username',
      icon: <User size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'email',
      label: dict.templates.fields.email,
      fieldType: 'email',
      sensitive: false,
      icon: <Mail size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'phone',
      label: dict.templates.fields.phone,
      fieldType: 'phone',
      sensitive: false,
      icon: <Phone size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'recovery_codes',
      label: dict.editor.presetRecoveryCodes,
      fieldType: 'multiline',
      sensitive: true,
      purpose: 'recovery_codes',
      icon: <ShieldAlert size={13} className="text-[var(--status-warning)] shrink-0" />,
    },
    {
      id: 'pin',
      label: dict.editor.presetPin,
      fieldType: 'password',
      sensitive: true,
      purpose: 'pin',
      icon: <Lock size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'url',
      label: dict.templates.urls.website,
      fieldType: 'url',
      sensitive: false,
      icon: <Globe size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'date',
      label: dict.editor.fieldTypes.date,
      fieldType: 'date',
      sensitive: false,
      icon: <Calendar size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
    {
      id: 'custom_text',
      label: dict.editor.customFieldOption,
      fieldType: 'text',
      sensitive: false,
      icon: <Type size={13} className="text-[var(--text-secondary)] shrink-0" />,
    },
  ];
}

const SINGLETON_PRESET_IDS = new Set(['username', 'password', 'totp']);

function hasExistingSingletonPreset(draft: ItemDraft, presetId: string): boolean {
  if (!SINGLETON_PRESET_IDS.has(presetId)) return false;
  const allFields = draft.sections.flatMap((s) => s.fields);
  if (presetId === 'username') return allFields.some((f) => f.purpose === 'username');
  if (presetId === 'password') {
    return allFields.some((f) => f.purpose === 'password' || f.fieldType === 'password');
  }
  if (presetId === 'totp') {
    return allFields.some((f) => f.purpose === 'totp' || f.fieldType === 'totp');
  }
  return false;
}

interface ItemEditorPaneProps {
  initialDraft: ItemDraft;
  isNew: boolean;
}

export function ItemEditorPane({ initialDraft, isNew }: ItemEditorPaneProps) {
  const { dict, fmt } = useI18n();
  const shortcuts = useUiStore((s) => s.shortcuts);
  const iconPopUid = useId().replace(/:/g, '');
  const iconPopoverId = `icon-pop-${iconPopUid}`;
  const iconAnchorName = `--icon-btn-${iconPopUid}`;
  const iconPopoverRef = useRef<HTMLDivElement>(null);
  const commonPresets = getCommonFieldPresets(dict);

  const [draft, setDraft] = useState<ItemDraft>(() => structuredClone(initialDraft));
  const [tagInput, setTagInput] = useState('');
  const [linkedSearch, setLinkedSearch] = useState('');
  const [domainIconHost, setDomainIconHost] = useState(
    initialDraft.icon?.kind === 'domain' ? initialDraft.icon.host : '',
  );
  const [saving, setSaving] = useState(false);
  const [sshGenerating, setSshGenerating] = useState(false);
  const [qrBusyFieldId, setQrBusyFieldId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [addMenuState, setAddMenuState] = useState<{
    sectionId: string;
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const [vaultMenuState, setVaultMenuState] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    minWidth: number;
    maxHeight: number;
  } | null>(null);
  const [vaultMenuHighlightIdx, setVaultMenuHighlightIdx] = useState(0);
  const [pointerDrag, setPointerDrag] = useState<{
    sectionId: string;
    fromIdx: number;
    overIdx: number;
  } | null>(null);

  const pointerDragRef = useRef<{
    sectionId: string;
    fromIdx: number;
    overIdx: number;
  } | null>(null);
  const draftRef = useRef(draft);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const vaultTriggerRef = useRef<HTMLButtonElement>(null);
  const fieldCardRefs = useRef(new Map<string, HTMLDivElement>());
  draftRef.current = draft;

  const vaults = useVaultStore((s) => s.vaults);
  const allItems = useVaultStore((s) => s.items);
  const tagCounts = useVaultStore((s) => s.tagCounts);
  const createItem = useVaultStore((s) => s.createItem);
  const updateItem = useVaultStore((s) => s.updateItem);

  const getFilter = useUiStore((s) => s.getFilter);
  const stopEditing = useUiStore((s) => s.stopEditing);
  const showToast = useUiStore((s) => s.showToast);

  const selectableVaults = useMemo(
    () => vaults.filter((v) => !v.isOrganization || v.id === draft.vaultId),
    [vaults, draft.vaultId],
  );
  const selectedVault = useMemo(
    () => selectableVaults.find((v) => v.id === draft.vaultId) ?? selectableVaults[0] ?? null,
    [selectableVaults, draft.vaultId],
  );

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft),
    [draft, initialDraft],
  );
  const isDirtyRef = useRef(isDirty);
  const confirmDiscardRef = useRef(confirmDiscard);
  const addMenuStateRef = useRef(addMenuState);
  const vaultMenuStateRef = useRef(vaultMenuState);
  const vaultMenuHighlightIdxRef = useRef(vaultMenuHighlightIdx);
  const selectableVaultsRef = useRef(selectableVaults);
  isDirtyRef.current = isDirty;
  confirmDiscardRef.current = confirmDiscard;
  addMenuStateRef.current = addMenuState;
  vaultMenuStateRef.current = vaultMenuState;
  vaultMenuHighlightIdxRef.current = vaultMenuHighlightIdx;
  selectableVaultsRef.current = selectableVaults;

  useEffect(() => {
    setDraft(structuredClone(initialDraft));
    setDomainIconHost(initialDraft.icon?.kind === 'domain' ? initialDraft.icon.host : '');
    setLinkedSearch('');
    setConfirmDiscard(false);
    setAddMenuState(null);
    setVaultMenuState(null);
    setPointerDrag(null);
    pointerDragRef.current = null;
  }, [initialDraft]);

  useEffect(() => {
    if (!isDirty && confirmDiscard) {
      setConfirmDiscard(false);
    }
  }, [isDirty, confirmDiscard]);

  useEffect(() => {
    if (!addMenuState) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && addMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-add-field-trigger="true"]')) return;
      setAddMenuState(null);
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setAddMenuState(null);
      }
    };
    const onResize = () => setAddMenuState(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDownCapture, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      window.removeEventListener('resize', onResize);
    };
  }, [addMenuState]);

  useEffect(() => {
    if (!vaultMenuState) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && vaultMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-vault-select-trigger="true"]')) return;
      setVaultMenuState(null);
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      const list = selectableVaultsRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setVaultMenuState(null);
        vaultTriggerRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setVaultMenuHighlightIdx((i) => (list.length ? (i + 1) % list.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setVaultMenuHighlightIdx((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        const chosen = list[vaultMenuHighlightIdxRef.current];
        if (chosen) {
          setDraft((p) => ({ ...p, vaultId: chosen.id }));
        }
        setVaultMenuState(null);
      }
    };
    const onResize = () => setVaultMenuState(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDownCapture, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      window.removeEventListener('resize', onResize);
    };
  }, [vaultMenuState]);

  useEffect(() => {
    const onRequestCancel = () => {
      if (vaultMenuStateRef.current) {
        setVaultMenuState(null);
        vaultTriggerRef.current?.blur();
        return;
      }
      if (addMenuStateRef.current) {
        setAddMenuState(null);
        return;
      }
      if (!isDirtyRef.current) {
        stopEditing();
        return;
      }
      setConfirmDiscard((prev) => !prev);
    };
    window.addEventListener('ks:editor-request-cancel', onRequestCancel);
    return () => window.removeEventListener('ks:editor-request-cancel', onRequestCancel);
  }, [stopEditing]);

  const requestCancel = () => {
    setVaultMenuState(null);
    setAddMenuState(null);
    if (!isDirty) {
      stopEditing();
      return;
    }
    setConfirmDiscard(true);
  };

  const toggleVaultMenu = () => {
    if (vaultMenuState) {
      setVaultMenuState(null);
      return;
    }
    setAddMenuState(null);
    setConfirmDiscard(false);
    const trigger = vaultTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 168);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - minWidth - 12));
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const curIdx = selectableVaults.findIndex((v) => v.id === draft.vaultId);
    setVaultMenuHighlightIdx(curIdx >= 0 ? curIdx : 0);
    if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
      setVaultMenuState({
        top: rect.bottom + 4,
        left,
        minWidth,
        maxHeight: Math.max(120, Math.min(260, spaceBelow)),
      });
    } else {
      setVaultMenuState({
        bottom: window.innerHeight - rect.top + 4,
        left,
        minWidth,
        maxHeight: Math.max(120, Math.min(260, spaceAbove)),
      });
    }
  };

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

  const startFieldPointerDrag = (
    e: React.PointerEvent,
    sectionId: string,
    fromIdx: number,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const initial = { sectionId, fromIdx, overIdx: fromIdx };
    pointerDragRef.current = initial;
    setPointerDrag(initial);

    const handleMove = (moveEvent: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      const fields =
        draftRef.current.sections.find((s) => s.id === cur.sectionId)?.fields ?? [];
      if (fields.length <= 1) return;

      let rank = 0;
      for (let i = 0; i < fields.length; i += 1) {
        if (i === cur.fromIdx) continue;
        const el = fieldCardRefs.current.get(`${cur.sectionId}:${fields[i].id}`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top + rect.height / 2 < moveEvent.clientY) {
          rank += 1;
        }
      }
      if (rank !== cur.overIdx) {
        const next = { ...cur, overIdx: rank };
        pointerDragRef.current = next;
        setPointerDrag(next);
      }
    };

    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      const cur = pointerDragRef.current;
      pointerDragRef.current = null;
      setPointerDrag(null);
      if (cur && cur.fromIdx !== cur.overIdx) {
        moveField(cur.sectionId, cur.fromIdx, cur.overIdx);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  const openAddFieldMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    sectionId: string,
  ) => {
    setVaultMenuState(null);
    if (addMenuState?.sectionId === sectionId) {
      setAddMenuState(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 248;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12));
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
      setAddMenuState({
        sectionId,
        top: rect.bottom + 6,
        left,
        maxHeight: Math.max(160, Math.min(360, spaceBelow)),
      });
    } else {
      setAddMenuState({
        sectionId,
        bottom: window.innerHeight - rect.top + 6,
        left,
        maxHeight: Math.max(160, Math.min(360, spaceAbove)),
      });
    }
  };

  const addFieldToSection = (sectionId: string, preset?: CommonFieldPreset) => {
    setDraft((prev) => {
      if (preset && hasExistingSingletonPreset(prev, preset.id)) {
        return prev;
      }
      return {
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
                    label: preset
                      ? preset.id === 'custom_text'
                        ? dict.editor.customFieldDefault
                        : preset.label
                      : dict.editor.customFieldDefault,
                    fieldType: preset?.fieldType ?? 'text',
                    value: '',
                    sensitive: preset?.sensitive ?? false,
                    copyable: true,
                    purpose: preset?.purpose,
                  },
                ],
              },
        ),
      };
    });
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

  const handleTotpFromScreen = async (sectionId: string, fieldId: string) => {
    setQrBusyFieldId(fieldId);
    try {
      const otpUri = await tauriClient.totpScanScreenQr();
      if (!otpUri) return;
      updateField(sectionId, fieldId, { value: otpUri, sensitive: true, purpose: 'totp' });
      showToast({
        label: dict.editor.totpQrLabel,
        text: dict.editor.totpQrScreenToast,
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

  const customChrome = isCustomWindowChrome();

  return (
    <form
      id="ks-item-editor-form"
      onSubmit={(e) => void handleSave(e)}
      className="h-full flex flex-col bg-[var(--bg-detail)] overflow-hidden"
    >
      {/* Sticky Editor Top Bar: Row 1 (Icon + Title + Cancel/Save aligned with window controls), Row 2 (Metadata) */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-detail)] shrink-0">
        <div
          data-tauri-drag-region={customChrome ? true : undefined}
          onDoubleClick={(e) => {
            if (customChrome && e.target === e.currentTarget) {
              void getCurrentWindow().toggleMaximize();
            }
          }}
          className={`px-5 ${customChrome ? 'pr-[126px]' : ''} pt-3.5 flex items-center justify-between gap-3 flex-nowrap`}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
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

            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              placeholder={dict.editor.titlePlaceholder}
              required
              autoFocus
              className="w-full min-w-0 flex-1 px-2.5 py-1 rounded-lg text-[17px] font-semibold bg-transparent hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-input)] border border-transparent focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:outline-none text-[var(--text-primary)] transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            <button
              type="button"
              onClick={requestCancel}
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
              {saving
                ? dict.editor.saving
                : fmt(dict.editor.saveWithShortcut, { shortcut: formatShortcut(shortcuts.saveItem) })}
            </button>
          </div>
        </div>

        <div className="px-5 pl-[64px] pt-2 pb-3 flex items-center flex-wrap gap-x-2.5 gap-y-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{dict.categories[draft.category] ?? tpl.label}</span>
          <span className="text-[var(--text-muted)]">·</span>
          <button
            type="button"
            ref={vaultTriggerRef}
            data-vault-select-trigger="true"
            aria-haspopup="listbox"
            aria-expanded={Boolean(vaultMenuState)}
            aria-label={dict.editor.vaultSelectAria}
            onClick={toggleVaultMenu}
            onKeyDown={(e) => {
              if (!vaultMenuState && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                toggleVaultMenu();
              }
            }}
            className="inline-flex items-center justify-between gap-1.5 min-h-[30px] min-w-[84px] max-w-[220px] px-2.5 py-1 rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)]/20 text-xs text-[var(--text-primary)] cursor-pointer transition-colors"
          >
            <span className="truncate">{selectedVault?.name ?? ''}</span>
            <ChevronDown
              size={12}
              className={`shrink-0 text-[var(--text-muted)] transition-transform ${
                vaultMenuState ? 'rotate-180' : ''
              }`}
            />
          </button>
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

        {confirmDiscard && (
          <div className="px-5 py-2 bg-amber-500/10 border-t border-amber-500/25 flex items-center justify-between gap-3 text-xs">
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              {dict.editor.discardConfirmTitle}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="px-2.5 py-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
              >
                {dict.editor.keepEditingBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false);
                  stopEditing();
                }}
                className="px-2.5 py-1 rounded-md bg-[var(--status-danger)] hover:opacity-90 text-white font-medium cursor-pointer"
              >
                {dict.editor.discardConfirmBtn}
              </button>
            </div>
          </div>
        )}
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
                const isSectionDragging = pointerDrag?.sectionId === section.id;
                const isDraggedCard = isSectionDragging && pointerDrag.fromIdx === fIdx;
                const showDropBefore =
                  isSectionDragging &&
                  pointerDrag.overIdx < pointerDrag.fromIdx &&
                  pointerDrag.overIdx === fIdx;
                const showDropAfter =
                  isSectionDragging &&
                  pointerDrag.overIdx > pointerDrag.fromIdx &&
                  pointerDrag.overIdx === fIdx;

                return (
                  <div
                    key={field.id}
                    ref={(el) => {
                      const mapKey = `${section.id}:${field.id}`;
                      if (el) {
                        fieldCardRefs.current.set(mapKey, el);
                      } else {
                        fieldCardRefs.current.delete(mapKey);
                      }
                    }}
                    className={`relative p-3 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex flex-col gap-2 transition-opacity ${
                      isDraggedCard ? 'opacity-55 ring-1 ring-[var(--accent-primary)]/45' : ''
                    }`}
                  >
                    {showDropBefore && (
                      <div className="pointer-events-none absolute -top-1.5 left-2 right-2 h-0.5 rounded-full bg-[var(--accent-primary)]" />
                    )}
                    {showDropAfter && (
                      <div className="pointer-events-none absolute -bottom-1.5 left-2 right-2 h-0.5 rounded-full bg-[var(--accent-primary)]" />
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                        <button
                          type="button"
                          tabIndex={-1}
                          onPointerDown={(e) => startFieldPointerDrag(e, section.id, fIdx)}
                          aria-label={dict.editor.dragSortTitle}
                          title={dict.editor.dragSortTitle}
                          className="p-0.5 rounded hover:bg-[var(--bg-hover)] cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 touch-none"
                        >
                          <GripVertical size={14} />
                        </button>
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
                            const curLabel = field.label.trim();
                            const shouldAutoLabel =
                              !curLabel ||
                              curLabel === dict.editor.customFieldDefault ||
                              curLabel === dict.editor.customSectionFieldDefault ||
                              curLabel === defaultLabelForFieldType(field.fieldType, dict);
                            updateField(section.id, field.id, {
                              fieldType: nextType,
                              label: shouldAutoLabel
                                ? defaultLabelForFieldType(nextType, dict)
                                : field.label,
                              sensitive: autoSensitive ? true : field.sensitive,
                              purpose:
                                nextType === 'totp'
                                  ? 'totp'
                                  : field.purpose === 'totp'
                                    ? undefined
                                    : field.purpose,
                            });
                          }}
                          aria-label={dict.editor.fieldTypeAria}
                          className="ks-select-sm min-w-[116px] max-w-[168px] text-[var(--text-secondary)] shrink-0 whitespace-nowrap"
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
                      <div className="flex items-center flex-wrap gap-2 mt-0.5 pt-2 border-t border-[var(--border-subtle)]/70">
                        <button
                          type="button"
                          disabled={qrBusyFieldId === field.id}
                          onClick={() => void handleTotpFromScreen(section.id, field.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer disabled:opacity-60"
                        >
                          <ScanLine size={11} />
                          {qrBusyFieldId === field.id ? dict.editor.qrRecognizing : dict.editor.scanQrScreen}
                        </button>
                        <button
                          type="button"
                          disabled={qrBusyFieldId === field.id}
                          onClick={() => void handleTotpFromClipboard(section.id, field.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-selected)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer disabled:opacity-60"
                        >
                          <ClipboardPaste size={11} />
                          {dict.editor.importQrClipboard}
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

            {(() => {
              const quickChips = commonPresets.filter(
                (p) => p.id === 'totp' || p.id === 'password' || p.id === 'recovery_codes',
              );
              const isMenuOpen = addMenuState?.sectionId === section.id;

              return (
                <div className="flex items-center flex-wrap gap-2 mt-1 pt-3 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    data-add-field-trigger="true"
                    aria-expanded={isMenuOpen}
                    onClick={(e) => openAddFieldMenu(e, section.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg-detail)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--accent-primary)] cursor-pointer"
                  >
                    <Plus size={13} />
                    <span>{dict.editor.addField}</span>
                    <ChevronDown size={12} className="opacity-70" />
                  </button>

                  {quickChips.map((chip) => {
                    const alreadyAdded = hasExistingSingletonPreset(draft, chip.id);
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        disabled={alreadyAdded}
                        title={alreadyAdded ? dict.editor.fieldAddedBadge : undefined}
                        onClick={() => addFieldToSection(section.id, chip)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[11px] ${
                          alreadyAdded
                            ? 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                            : 'hover:bg-[var(--bg-selected)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer'
                        }`}
                      >
                        {alreadyAdded ? <Check size={11} /> : <Plus size={11} />}
                        <span>{chip.label}</span>
                      </button>
                    );
                  })}

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
              );
            })()}
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

      {addMenuState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={addMenuRef}
            role="menu"
            data-ks-dropdown-open="true"
            style={{
              position: 'fixed',
              left: addMenuState.left,
              top: addMenuState.top,
              bottom: addMenuState.bottom,
              width: 248,
              maxHeight: addMenuState.maxHeight,
              zIndex: 70,
            }}
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl overflow-y-auto ks-scroll p-1.5 flex flex-col gap-0.5 text-xs"
          >
            <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[var(--text-muted)]">
              {dict.editor.commonFieldsTitle}
            </div>
            {commonPresets.map((preset) => {
              const alreadyAdded = hasExistingSingletonPreset(draft, preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitem"
                  disabled={alreadyAdded}
                  onClick={() => {
                    if (alreadyAdded) return;
                    addFieldToSection(addMenuState.sectionId, preset);
                    setAddMenuState(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left ${
                    alreadyAdded
                      ? 'text-[var(--text-muted)] opacity-55 cursor-not-allowed'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    {preset.icon}
                    <span className="truncate font-medium">{preset.label}</span>
                  </span>
                  {alreadyAdded ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] shrink-0">
                      <Check size={11} />
                      {dict.editor.fieldAddedBadge}
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-[var(--text-muted)] shrink-0">
                      {dict.editor.fieldTypes[preset.fieldType as keyof typeof dict.editor.fieldTypes] ??
                        preset.fieldType}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {vaultMenuState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={vaultMenuRef}
            role="listbox"
            aria-label={dict.editor.vaultSelectAria}
            data-ks-dropdown-open="true"
            style={{
              position: 'fixed',
              left: vaultMenuState.left,
              top: vaultMenuState.top,
              bottom: vaultMenuState.bottom,
              minWidth: vaultMenuState.minWidth,
              maxWidth: 280,
              maxHeight: vaultMenuState.maxHeight,
              zIndex: 70,
            }}
            className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl overflow-y-auto ks-scroll p-1 flex flex-col gap-0.5 text-xs"
          >
            {selectableVaults.map((v, idx) => {
              const isSelected = v.id === draft.vaultId;
              const isHighlighted = idx === vaultMenuHighlightIdx;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setVaultMenuHighlightIdx(idx)}
                  onClick={() => {
                    setDraft((p) => ({ ...p, vaultId: v.id }));
                    setVaultMenuState(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)] font-medium'
                      : isHighlighted
                        ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                        : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  {isSelected && <Check size={12} className="shrink-0 text-[var(--accent-primary)]" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </form>
  );
}
