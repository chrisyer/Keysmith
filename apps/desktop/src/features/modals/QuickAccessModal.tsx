import { ArrowRight, Check, Copy, ExternalLink, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ColoredPassword } from '../../components/ColoredPassword';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { ModalDialog } from '../../components/ModalDialog';
import { TotpRow } from '../../components/TotpRow';
import { tauriClient } from '../../services/tauriClient';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { ItemDetail, ItemSummary } from '../../types/domain';

export function QuickAccessModal() {
  const open = useUiStore((s) => s.quickAccessOpen);
  const setQuickAccessOpen = useUiStore((s) => s.setQuickAccessOpen);
  const setViewAll = useUiStore((s) => s.setViewAll);
  const showToast = useUiStore((s) => s.showToast);

  const selectItem = useVaultStore((s) => s.selectItem);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDetail, setPreviewDetail] = useState<ItemDetail | null>(null);
  const [inlineMsg, setInlineMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void tauriClient.itemList({ query, trashed: false, sortBy: 'title_asc' }).then((list) => {
      if (!active) return;
      setResults(list);
      setSelectedIdx(0);
    });
    return () => {
      active = false;
    };
  }, [open, query]);

  const activeSummary = results[selectedIdx] ?? null;

  useEffect(() => {
    if (!open || !activeSummary) {
      setPreviewDetail(null);
      return;
    }
    let active = true;
    void tauriClient.itemGet(activeSummary.id).then((d) => {
      if (active) setPreviewDetail(d);
    });
    return () => {
      active = false;
    };
  }, [open, activeSummary?.id]);

  const handleClose = () => {
    setQuery('');
    setPreviewOpen(false);
    setInlineMsg(null);
    setQuickAccessOpen(false);
  };

  const copyFieldAndClose = async (kind: 'password' | 'username' | 'totp') => {
    if (!previewDetail) return;
    const fields = previewDetail.sections.flatMap((s) => s.fields);

    if (kind === 'password') {
      const pw = fields.find((f) => f.purpose === 'password' && f.value) ?? fields.find((f) => f.sensitive && f.value);
      if (!pw) {
        setInlineMsg('该条目没有可复制的密码字段');
        return;
      }
      await tauriClient.clipboardCopySecret(pw.value, pw.label, true);
      handleClose();
      showToast({ label: pw.label, text: `Quick Access 已复制「${previewDetail.title} · ${pw.label}」`, kind: 'clipboard' });
      return;
    }

    if (kind === 'username') {
      const user = fields.find((f) => f.purpose === 'username' && f.value);
      if (!user) {
        setInlineMsg('该条目没有用户名字段');
        return;
      }
      await tauriClient.clipboardCopySecret(user.value, user.label, false);
      handleClose();
      showToast({ label: user.label, text: `Quick Access 已复制「${user.value}」`, kind: 'info' });
      return;
    }

    if (kind === 'totp') {
      const totp = fields.find((f) => f.fieldType === 'totp' && f.value);
      if (!totp) {
        setInlineMsg('该条目未配置一次性密码');
        return;
      }
      const res = await tauriClient.totpCompute(totp.value);
      await tauriClient.clipboardCopySecret(res.code, '一次性密码', true);
      handleClose();
      showToast({ label: '一次性密码', text: `Quick Access 已复制验证码 ${res.formattedCode}`, kind: 'clipboard' });
    }
  };

  const openInMain = async () => {
    if (!activeSummary) return;
    setViewAll();
    await selectItem(activeSummary.id);
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'ArrowRight' && !previewOpen) {
      e.preventDefault();
      setPreviewOpen(true);
    } else if (e.key === 'ArrowLeft' && previewOpen) {
      e.preventDefault();
      setPreviewOpen(false);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      void openInMain();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.altKey) {
        void copyFieldAndClose('totp');
      } else if (e.shiftKey) {
        void copyFieldAndClose('username');
      } else {
        void copyFieldAndClose('password');
      }
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={handleClose}
      ariaLabel="Quick Access 快速搜索悬浮窗"
      closedBy="any"
      className={`rounded-2xl shadow-2xl transition-[width] duration-200 ${
        previewOpen ? 'w-[min(860px,94vw)]' : 'w-[min(620px,92vw)]'
      }`}
    >
      <div className="flex flex-col max-h-[75dvh]" onKeyDown={handleKeyDown}>
        {/* Spotlight Search Input */}
        <div className="px-4 py-3.5 border-b border-[var(--border-subtle)] flex items-center gap-3">
          <Search size={18} className="text-[var(--accent-primary)] shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Quick Access：搜索站点、用户名、标签或拼音..."
            aria-label="Quick Access 搜索框"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          {inlineMsg && (
            <span className="text-[11px] text-[var(--status-warning)] shrink-0">{inlineMsg}</span>
          )}
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] cursor-pointer"
          >
            {previewOpen ? '收起预览 ←' : '展开预览 →'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="关闭 Quick Access"
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Split Body: Results + Optional Mini Preview */}
        <div className="flex-1 min-h-[300px] max-h-[420px] flex overflow-hidden">
          <div className="flex-1 overflow-y-auto ks-scroll p-2 flex flex-col gap-0.5">
            {results.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)] py-12">
                无匹配条目
              </div>
            ) : (
              results.map((item, idx) => {
                const selected = idx === selectedIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedIdx(idx);
                      setPreviewOpen(true);
                    }}
                    onDoubleClick={() => void copyFieldAndClose('password')}
                    className={`w-full px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      selected ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ItemIconBadge icon={item.icon} category={item.category} title={item.title} size="sm" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] truncate">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                    {selected && (
                      <span className="text-[11px] text-[var(--accent-primary)] font-medium shrink-0 flex items-center gap-1">
                        ⏎ 复制密码
                        <ArrowRight size={12} />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {previewOpen && previewDetail && (
            <div className="w-[340px] shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-card)]/55 overflow-y-auto ks-scroll p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ItemIconBadge
                    icon={previewDetail.icon}
                    category={previewDetail.category}
                    title={previewDetail.title}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {previewDetail.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {previewDetail.urls[0]?.uri || previewDetail.subtitle}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openInMain()}
                  title="在主窗口中打开 (⌘O)"
                  aria-label="在主窗口中打开"
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--accent-primary)] cursor-pointer shrink-0"
                >
                  <ExternalLink size={14} />
                </button>
              </div>

              <div className="rounded-xl bg-[var(--bg-detail)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {previewDetail.sections.flatMap((s) => s.fields).map((field) => {
                  if (field.fieldType === 'totp' && field.value) {
                    return <TotpRow key={field.id} label={field.label} secretOrUri={field.value} />;
                  }
                  return (
                    <div
                      key={field.id}
                      onClick={() => {
                        if (!field.value) return;
                        void tauriClient.clipboardCopySecret(field.value, field.label, field.sensitive);
                        setInlineMsg(`已复制「${field.label}」`);
                        setTimeout(() => setInlineMsg(null), 1600);
                      }}
                      className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[var(--bg-hover)] cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] text-[var(--text-muted)]">{field.label}</div>
                        <div className="text-xs truncate mt-0.5">
                          {field.sensitive ? (
                            <ColoredPassword value={field.value} revealed={false} />
                          ) : (
                            <span className="text-[var(--text-primary)]">{field.value || '—'}</span>
                          )}
                        </div>
                      </div>
                      {field.copyable && field.value && (
                        <Copy size={12} className="text-[var(--text-muted)] shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyFieldAndClose('password')}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Check size={12} />
                  复制密码
                </button>
                <button
                  type="button"
                  onClick={() => void copyFieldAndClose('username')}
                  className="py-1.5 px-2.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  复制用户名
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Keyboard Legend Footer */}
        <div className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/60 flex items-center justify-between flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">↑↓</kbd> 选择</span>
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">⏎</kbd> 复制密码</span>
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">⇧⏎</kbd> 用户名</span>
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">⌥⏎</kbd> TOTP</span>
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">→</kbd> 预览</span>
            <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">⌘O</kbd> 主窗口打开</span>
          </div>
          <span>Esc 隐藏</span>
        </div>
      </div>
    </ModalDialog>
  );
}
