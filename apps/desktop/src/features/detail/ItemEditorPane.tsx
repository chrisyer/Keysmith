import {
  ArrowDown,
  ArrowUp,
  Check,
  Fingerprint,
  GripVertical,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { GeneratorPopover } from '../../components/GeneratorPopover';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { TEMPLATE_MAP } from '../../services/templates';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { FieldType, ItemDraft, ItemField, UrlMatchRule } from '../../types/domain';
import { makeId } from '../../utils/format';

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'password', label: '密码' },
  { value: 'totp', label: 'TOTP 验证码' },
  { value: 'email', label: '邮箱' },
  { value: 'url', label: '网址' },
  { value: 'date', label: '日期' },
  { value: 'month_year', label: '年月 (YYYY-MM)' },
  { value: 'phone', label: '电话' },
  { value: 'number', label: '数字' },
  { value: 'multiline', label: '多行文本' },
  { value: 'ssh_public_key', label: 'SSH 公钥' },
  { value: 'ssh_private_key', label: 'SSH 私钥' },
];

const URL_RULES: Array<{ value: UrlMatchRule; label: string }> = [
  { value: 'domain', label: '主域匹配 (默认)' },
  { value: 'host', label: '精确主机+端口' },
  { value: 'starts_with', label: '前缀匹配' },
  { value: 'exact', label: '完全匹配' },
  { value: 'never', label: '仅作跳转链接' },
];

interface ItemEditorPaneProps {
  initialDraft: ItemDraft;
  isNew: boolean;
}

export function ItemEditorPane({ initialDraft, isNew }: ItemEditorPaneProps) {
  const [draft, setDraft] = useState<ItemDraft>(() => structuredClone(initialDraft));
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragInfo, setDragInfo] = useState<{ sectionId: string; fieldIndex: number } | null>(null);

  useEffect(() => {
    setDraft(structuredClone(initialDraft));
  }, [initialDraft]);

  const vaults = useVaultStore((s) => s.vaults);
  const tagCounts = useVaultStore((s) => s.tagCounts);
  const createItem = useVaultStore((s) => s.createItem);
  const updateItem = useVaultStore((s) => s.updateItem);

  const getFilter = useUiStore((s) => s.getFilter);
  const stopEditing = useUiStore((s) => s.stopEditing);
  const showToast = useUiStore((s) => s.showToast);

  const tpl = TEMPLATE_MAP[draft.category];

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      if (isNew || !draft.id) {
        await createItem(draft, getFilter());
        showToast({ label: '新建条目', text: `已创建「${draft.title || '未命名条目'}」`, kind: 'info' });
      } else {
        await updateItem(draft.id, draft, getFilter());
        showToast({ label: '保存条目', text: `已保存「${draft.title}」的修改`, kind: 'info' });
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
                  label: '自定义字段',
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
          title: '自定义分组',
          fields: [
            {
              id: makeId('f'),
              label: '字段名称',
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

  return (
    <form
      id="ks-item-editor-form"
      onSubmit={(e) => void handleSave(e)}
      className="h-full flex flex-col bg-[var(--bg-detail)] overflow-hidden"
    >
      {/* Sticky Editor Top Bar */}
      <header className="px-7 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 shrink-0 bg-[var(--bg-detail)]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <ItemIconBadge icon={draft.icon} category={draft.category} title={draft.title} size="md" />
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              placeholder="条目标题"
              required
              autoFocus
              className="w-full text-lg font-semibold bg-transparent border-b border-transparent focus:border-[var(--accent-primary)] focus:outline-none text-[var(--text-primary)] pb-0.5"
            />
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-[var(--text-muted)]">{tpl.label}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <select
                value={draft.vaultId}
                onChange={(e) => setDraft((p) => ({ ...p, vaultId: e.target.value }))}
                aria-label="所属保险库"
                className="text-[11px] font-medium bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-md px-2 py-0.5 text-[var(--text-primary)]"
              >
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={stopEditing}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] cursor-pointer"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white shadow-xs cursor-pointer"
          >
            <Check size={14} />
            {saving ? '保存中...' : '保存  ⌘S'}
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
                <span className="text-xs font-semibold text-[var(--text-secondary)]">主要字段</span>
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
                  placeholder="分组标题"
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
                  aria-label="删除分组"
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--status-danger)] cursor-pointer"
                >
                  移除分组
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="cursor-grab text-[var(--text-muted)]" title="拖拽排序">
                          <GripVertical size={14} />
                        </span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateField(section.id, field.id, { label: e.target.value })}
                          placeholder="字段标签"
                          className="text-xs font-medium bg-transparent border-b border-transparent focus:border-[var(--accent-primary)] focus:outline-none text-[var(--text-secondary)] w-36"
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
                          aria-label="字段类型"
                          className="text-[11px] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[var(--text-secondary)]"
                        >
                          {FIELD_TYPES.map((ft) => (
                            <option key={ft.value} value={ft.value}>
                              {ft.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] cursor-pointer mr-1">
                          <input
                            type="checkbox"
                            checked={field.sensitive}
                            onChange={(e) =>
                              updateField(section.id, field.id, { sensitive: e.target.checked })
                            }
                            className="ks-checkbox"
                          />
                          掩码
                        </label>
                        <button
                          type="button"
                          onClick={() => moveField(section.id, fIdx, fIdx - 1)}
                          disabled={fIdx === 0}
                          aria-label="上移字段"
                          className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 text-[var(--text-muted)] cursor-pointer"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(section.id, fIdx, fIdx + 1)}
                          disabled={fIdx === section.fields.length - 1}
                          aria-label="下移字段"
                          className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30 text-[var(--text-muted)] cursor-pointer"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(section.id, field.id)}
                          aria-label="删除字段"
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
                          placeholder="输入内容..."
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-xs font-mono-tabular text-[var(--text-primary)]"
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
                          placeholder={field.fieldType === 'totp' ? 'otpauth://totp/... 或 Base32 密钥' : '输入字段值...'}
                          className={`w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-[13px] ${
                            isSecret ? 'font-mono-tabular' : ''
                          } text-[var(--text-primary)]`}
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
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => addFieldToSection(section.id)}
              className="self-start inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              <Plus size={13} />
              添加字段
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addSection}
          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-strong)] hover:border-[var(--accent-primary)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
        >
          <Plus size={13} />
          新增自定义分组 (Section)
        </button>

        {/* Passkeys Bound List */}
        {draft.passkeys.length > 0 && (
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
              <Fingerprint size={14} className="text-sky-500" />
              已绑定通行密钥 ({draft.passkeys.length})
            </span>
            <div className="flex flex-col gap-2">
              {draft.passkeys.map((pk) => (
                <div
                  key={pk.credentialId}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--text-primary)] truncate">
                      {pk.rpName} ({pk.rpId}) · {pk.userName}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono-tabular truncate">
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
                    解绑
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* URLs Editor */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">关联网址</span>
            <button
              type="button"
              onClick={() =>
                setDraft((p) => ({
                  ...p,
                  urls: [...p.urls, { id: makeId('u'), uri: '', label: '网址', matchRule: 'domain' }],
                }))
              }
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
            >
              <Plus size={13} />
              添加网址
            </button>
          </div>

          {draft.urls.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">暂无关联网址</p>
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
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-xs font-mono-tabular text-[var(--text-primary)]"
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
                    aria-label="网址匹配规则"
                    className="text-[11px] bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded-lg px-2 py-1.5 text-[var(--text-secondary)]"
                  >
                    {URL_RULES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({ ...p, urls: p.urls.filter((x) => x.id !== u.id) }))
                    }
                    aria-label="移除网址"
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
          <span className="text-xs font-semibold text-[var(--text-secondary)]">标签</span>
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
                  aria-label={`移除标签 ${tag}`}
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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder="输入标签按回车添加..."
              className="px-2 py-1 text-xs bg-transparent focus:outline-none text-[var(--text-primary)] min-w-[140px]"
            />
          </div>
          {tagCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[11px] text-[var(--text-muted)] mr-1">常用标签：</span>
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

        {/* Notes Editor */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4 flex flex-col gap-2">
          <label htmlFor="editor-notes" className="text-xs font-semibold text-[var(--text-secondary)]">
            备注（支持 Markdown）
          </label>
          <textarea
            id="editor-notes"
            rows={4}
            value={draft.notes}
            onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
            placeholder="记录账号用途、恢复注意事项或内网连接说明..."
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none text-xs leading-relaxed text-[var(--text-primary)]"
          />
        </div>
      </div>
    </form>
  );
}
