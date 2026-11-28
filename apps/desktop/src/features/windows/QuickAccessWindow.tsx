import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowRight, Check, Copy, ExternalLink, Keyboard, Lock, Maximize2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ColoredPassword } from '../../components/ColoredPassword';
import { ItemIconBadge } from '../../components/ItemIconBadge';
import { TotpRow } from '../../components/TotpRow';
import { localizeBuiltinFieldLabel, useI18n } from '../../i18n';
import { isTauriRuntime, tauriClient } from '../../services/tauriClient';
import type { AuthStatus, ItemDetail, ItemSummary } from '../../types/domain';
import { formatShortcut } from '../../utils/shortcuts';

export function QuickAccessWindow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dict, fmt } = useI18n();

  const [authStatus, setAuthStatus] = useState<AuthStatus>('Unlocked');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSummary[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewDetail, setPreviewDetail] = useState<ItemDetail | null>(null);
  const [inlineMsg, setInlineMsg] = useState<string | null>(null);
  const queryRef = useRef(query);
  const authStatusRef = useRef(authStatus);
  const lastFocusTsRef = useRef(Date.now());
  queryRef.current = query;
  authStatusRef.current = authStatus;

  const refreshResults = async (search: string, showSpinner = false) => {
    if (showSpinner) setLoadingItems(true);
    try {
      const list = await tauriClient.itemList({
        query: search.trim(),
        trashed: false,
        sortBy: 'title_asc',
      });
      setResults(list);
      setSelectedIdx(0);
    } catch {
      setResults([]);
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    void tauriClient
      .sessionGetState()
      .then((s) => {
        setAuthStatus(s.status);
        authStatusRef.current = s.status;
        if (s.status === 'Unlocked') {
          void refreshResults('', true);
        } else {
          setLoadingItems(false);
        }
      })
      .catch(() => {
        setAuthStatus('Locked');
        setLoadingItems(false);
      });

    const unsubSession = tauriClient.onEvent('session:state_changed', ({ status }) => {
      setAuthStatus(status);
      authStatusRef.current = status;
      if (status === 'Unlocked') {
        void refreshResults(queryRef.current);
      } else {
        setResults([]);
        setPreviewDetail(null);
      }
    });

    const unsubData = tauriClient.onEvent('sync:data_changed', () => {
      if (authStatusRef.current === 'Unlocked') {
        void refreshResults(queryRef.current);
      }
    });

    const onFocus = () => {
      lastFocusTsRef.current = Date.now();
      setInlineMsg(null);
      if (!queryRef.current.trim()) {
        setQuery('');
      }
      inputRef.current?.focus();
      inputRef.current?.select();
      void tauriClient.sessionGetState().then((s) => {
        setAuthStatus(s.status);
        authStatusRef.current = s.status;
        if (s.status === 'Unlocked') {
          void refreshResults(queryRef.current, results.length === 0);
        }
      });
    };

    window.addEventListener('focus', onFocus);
    return () => {
      unsubSession();
      unsubData();
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authStatus !== 'Unlocked') return;
    let active = true;
    void tauriClient
      .itemList({ query: query.trim(), trashed: false, sortBy: 'title_asc' })
      .then((list) => {
        if (!active) return;
        setResults(list);
        setSelectedIdx(0);
        setLoadingItems(false);
      })
      .catch(() => {
        if (active) {
          setResults([]);
          setLoadingItems(false);
        }
      });
    return () => {
      active = false;
    };
  }, [authStatus, query]);

  const activeSummary = results[selectedIdx] ?? null;

  useEffect(() => {
    if (authStatus !== 'Unlocked' || !activeSummary) {
      setPreviewDetail(null);
      return;
    }
    let active = true;
    void tauriClient
      .itemGet(activeSummary.id)
      .then((d) => {
        if (active) setPreviewDetail(d);
      })
      .catch(() => {
        if (active) setPreviewDetail(null);
      });
    return () => {
      active = false;
    };
  }, [authStatus, activeSummary?.id]);

  const hideWindow = () => {
    setInlineMsg(null);
    setQuery('');
    void tauriClient.windowHideQuickAccess();
  };

  const copyFieldAndHide = async (kind: 'password' | 'username' | 'totp') => {
    if (!activeSummary) return;
    const detail =
      previewDetail && previewDetail.id === activeSummary.id
        ? previewDetail
        : await tauriClient.itemGet(activeSummary.id).catch(() => null);
    if (!detail) return;
    if (detail.reprompt && (kind === 'password' || kind === 'totp')) {
      setInlineMsg(dict.quickAccess.repromptRequired);
      await openInMain();
      return;
    }
    const fields = detail.sections.flatMap((s) => s.fields);

    if (kind === 'password') {
      const pw =
        fields.find((f) => f.purpose === 'password' && f.value) ??
        fields.find((f) => f.sensitive && f.value) ??
        fields.find((f) => f.copyable && f.value);
      if (!pw) {
        setInlineMsg(dict.common.none);
        return;
      }
      if (detail.reprompt && pw.sensitive) {
        setInlineMsg(dict.quickAccess.repromptRequired);
        await openInMain();
        return;
      }
      await tauriClient.clipboardCopySecret(
        pw.value,
        localizeBuiltinFieldLabel(pw.label, dict, pw.purpose),
        pw.sensitive,
      );
      hideWindow();
      return;
    }

    if (kind === 'username') {
      const user = fields.find((f) => f.purpose === 'username' && f.value);
      if (!user) {
        setInlineMsg(dict.common.none);
        return;
      }
      await tauriClient.clipboardCopySecret(
        user.value,
        localizeBuiltinFieldLabel(user.label, dict, user.purpose),
        false,
      );
      hideWindow();
      return;
    }

    if (kind === 'totp') {
      const totp = fields.find((f) => f.fieldType === 'totp' && f.value);
      if (!totp) {
        setInlineMsg(dict.common.none);
        return;
      }
      const res = await tauriClient.totpCompute(totp.value);
      await tauriClient.clipboardCopySecret(res.code, 'TOTP', true);
      hideWindow();
    }
  };

  const openInMain = async () => {
    if (!activeSummary) return;
    await tauriClient.windowFocusMainItem(activeSummary.id);
    hideWindow();
  };

  const triggerAutoType = async () => {
    if (!activeSummary) return;
    const detail =
      previewDetail && previewDetail.id === activeSummary.id
        ? previewDetail
        : await tauriClient.itemGet(activeSummary.id).catch(() => null);
    if (detail?.reprompt) {
      setInlineMsg(dict.quickAccess.repromptRequired);
      await openInMain();
      return;
    }
    try {
      await tauriClient.autofillAutoType(activeSummary.id, 'credentials', true);
    } catch (err) {
      setInlineMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      hideWindow();
      return;
    }
    if (authStatus !== 'Unlocked') return;

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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        void triggerAutoType();
      } else if (e.altKey) {
        void copyFieldAndHide('totp');
      } else if (e.shiftKey) {
        void copyFieldAndHide('username');
      } else {
        void copyFieldAndHide('password');
      }
    }
  };

  const repromptLocked = Boolean(previewDetail?.reprompt);
  const previewPw = previewDetail?.sections
    .flatMap((s) => s.fields)
    .find((f) => (f.purpose === 'password' || f.sensitive) && f.value);

  return (
    <div
      className="h-dvh w-screen rounded-[14px] bg-[var(--bg-elevated)] text-[var(--text-primary)] flex flex-col overflow-hidden border border-[var(--border-strong)] shadow-2xl"
      onKeyDown={handleKeyDown}
    >
      {authStatus !== 'Unlocked' ? (
        <>
          <div
            data-tauri-drag-region
            className="px-4 py-2.5 flex items-center justify-end shrink-0"
          >
            <button
              type="button"
              onClick={hideWindow}
              aria-label={dict.common.close}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent-primary)]">
              <Lock size={18} />
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {authStatus === 'Locked' ? dict.quickAccess.lockedTitle : dict.quickAccess.unauthTitle}
            </div>
            <p className="text-xs text-[var(--text-secondary)] max-w-xs">
              {dict.quickAccess.lockedHint}
            </p>
            <button
              type="button"
              onClick={() => {
                void tauriClient.windowFocusMainItem('');
                hideWindow();
              }}
              className="px-3.5 py-2 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              {dict.quickAccess.openMainBtn}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            data-tauri-drag-region
            onMouseDown={(e) => {
              if (e.button === 0 && isTauriRuntime()) {
                void getCurrentWindow().startDragging();
              }
            }}
            className="h-5 w-full shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
          >
            <span className="w-9 h-1 rounded-full bg-[var(--border-strong)]/75 pointer-events-none" />
          </div>
          <div className="px-5 pt-0.5 pb-3 border-b border-[var(--border-subtle)] flex items-center gap-3 shrink-0">
            <span
              data-tauri-drag-region
              onMouseDown={(e) => {
                if (e.button === 0 && isTauriRuntime()) {
                  void getCurrentWindow().startDragging();
                }
              }}
              className="inline-flex items-center shrink-0 cursor-grab active:cursor-grabbing"
            >
              <Search size={17} className="text-[var(--accent-primary)] pointer-events-none" />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                if (
                  queryRef.current === '' &&
                  next.length > 0 &&
                  next.trim() === '' &&
                  Date.now() - lastFocusTsRef.current < 180
                ) {
                  return;
                }
                setQuery(next);
              }}
              autoFocus
              placeholder={dict.quickAccess.searchPlaceholder}
              aria-label={dict.common.search}
              className="flex-1 bg-transparent text-[15px] leading-snug text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border-0 outline-none focus:outline-none focus:ring-0"
            />
            {inlineMsg && (
              <span className="text-[11px] text-[var(--status-warning)] shrink-0">{inlineMsg}</span>
            )}
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="px-2 py-1 rounded-md bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] cursor-pointer shrink-0"
            >
              {previewOpen ? dict.quickAccess.hidePreview : dict.quickAccess.showPreview}
            </button>
            <button
              type="button"
              onClick={hideWindow}
              aria-label={dict.common.close}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto ks-scroll p-2.5 flex flex-col gap-0.5">
              {loadingItems && results.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)] py-12">
                  {dict.quickAccess.loading}
                </div>
              ) : results.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)] py-12">
                  {dict.quickAccess.noMatch}
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
                      onDoubleClick={() => void copyFieldAndHide('password')}
                      className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
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
                          {formatShortcut('Enter')} {item.hasPassword ? dict.quickAccess.copyPw : dict.quickAccess.copyFirst}
                          <ArrowRight size={11} />
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {previewOpen && previewDetail && (
              <div className="w-[380px] shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-card)]/55 p-4 flex flex-col gap-3 overflow-hidden">
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ItemIconBadge
                      icon={previewDetail.icon}
                      category={previewDetail.category}
                      title={previewDetail.title}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-[var(--text-primary)] truncate">
                        {previewDetail.title}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">
                        {previewDetail.urls[0]?.uri || previewDetail.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {previewPw && !repromptLocked && (
                      <button
                        type="button"
                        onClick={() =>
                          void tauriClient.windowOpenLargeType(
                            localizeBuiltinFieldLabel(previewPw.label, dict, previewPw.purpose),
                            previewPw.value,
                          )
                        }
                        title={dict.quickAccess.largeType}
                        aria-label={dict.quickAccess.largeType}
                        className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] cursor-pointer"
                      >
                        <Maximize2 size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void openInMain()}
                      title={fmt(dict.quickAccess.openInMainTitle, {
                        shortcut: formatShortcut('CommandOrControl+O'),
                      })}
                      aria-label={dict.quickAccess.openInMain}
                      className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--accent-primary)] cursor-pointer"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto ks-scroll rounded-lg bg-[var(--bg-detail)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {previewDetail.sections.flatMap((s) => s.fields).map((field) => {
                    const fieldLabel = localizeBuiltinFieldLabel(field.label, dict, field.purpose);
                    if (field.fieldType === 'totp' && field.value) {
                      if (repromptLocked) {
                        return (
                          <div
                            key={field.id}
                            onClick={() => {
                              setInlineMsg(dict.quickAccess.repromptRequired);
                              void openInMain();
                            }}
                            className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[var(--bg-hover)] cursor-pointer"
                          >
                            <div className="min-w-0">
                              <div className="text-[10.5px] text-[var(--text-muted)]">{fieldLabel}</div>
                              <div className="font-mono-tabular tracking-[0.18em] text-xs text-[var(--text-muted)] mt-0.5">
                                ••••••
                              </div>
                            </div>
                            <Lock size={12} className="text-[var(--text-muted)] shrink-0" />
                          </div>
                        );
                      }
                      return <TotpRow key={field.id} label={fieldLabel} secretOrUri={field.value} />;
                    }
                    return (
                      <div
                        key={field.id}
                        onClick={() => {
                          if (!field.value) return;
                          if (repromptLocked && field.sensitive) {
                            setInlineMsg(dict.quickAccess.repromptRequired);
                            void openInMain();
                            return;
                          }
                          void tauriClient.clipboardCopySecret(field.value, fieldLabel, field.sensitive);
                          setInlineMsg(fmt(dict.quickAccess.copiedFieldInline, { label: fieldLabel }));
                          setTimeout(() => setInlineMsg(null), 1600);
                        }}
                        className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[var(--bg-hover)] cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-[10.5px] text-[var(--text-muted)]">{fieldLabel}</div>
                          <div className="text-xs truncate mt-0.5">
                            {field.sensitive ? (
                              repromptLocked ? (
                                <span className="font-mono-tabular tracking-[0.18em] text-[var(--text-muted)]">
                                  ••••••••••••
                                </span>
                              ) : (
                                <ColoredPassword value={field.value} revealed={false} />
                              )
                            ) : (
                              <span className="text-[var(--text-primary)]">{field.value || '—'}</span>
                            )}
                          </div>
                        </div>
                        {field.copyable && field.value && (
                          repromptLocked && field.sensitive ? (
                            <Lock size={12} className="text-[var(--text-muted)] shrink-0" />
                          ) : (
                            <Copy size={12} className="text-[var(--text-muted)] shrink-0" />
                          )
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void copyFieldAndHide('password')}
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-medium flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Check size={12} />
                    {activeSummary?.hasPassword ? dict.quickAccess.copyPw : dict.quickAccess.copyFirst}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyFieldAndHide('username')}
                    className="py-1.5 px-2.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  >
                    {dict.quickAccess.copyUser}
                  </button>
                  <button
                    type="button"
                    onClick={() => void triggerAutoType()}
                    title={formatShortcut('CommandOrControl+Shift+Enter')}
                    className="py-1.5 px-2.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Keyboard size={12} />
                    {dict.quickAccess.autoTypeBtn}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/60 flex items-center justify-between flex-wrap gap-x-4 gap-y-1.5 text-[10.5px] text-[var(--text-muted)] shrink-0">
            <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1">
              <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">{formatShortcut('Enter')}</kbd> {dict.quickAccess.legendCopyPw}</span>
              <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">{formatShortcut('Shift+Enter')}</kbd> {dict.quickAccess.legendCopyUser}</span>
              <span><kbd className="font-mono-tabular px-1 rounded bg-[var(--bg-detail)] border border-[var(--border-subtle)]">{formatShortcut('CommandOrControl+O')}</kbd> {dict.quickAccess.legendOpenMain}</span>
            </div>
            <span>{dict.quickAccess.legendEscHide}</span>
          </div>
        </>
      )}
    </div>
  );
}
