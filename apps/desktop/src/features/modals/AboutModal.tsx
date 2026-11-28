import { CheckCircle2, ExternalLink, Globe, KeyRound, Layers, RefreshCw, Shield, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { useI18n } from '../../i18n';
import { tauriClient } from '../../services/tauriClient';
import { useUiStore } from '../../stores/uiStore';
import type { AppUpdateInfo } from '../../types/domain';
import { openExternalUrl } from '../../utils/opener';

const AUTHOR_URL = 'https://github.com/chrisyer';
const REPO_URL = 'https://github.com/chrisyer/Keysmith';
const RELEASES_URL = 'https://github.com/chrisyer/Keysmith/releases';
const ISSUES_URL = 'https://github.com/chrisyer/Keysmith/issues';

interface AboutContentProps {
  autoCheckUpdate?: boolean;
}

export function AboutContent({ autoCheckUpdate = false }: AboutContentProps) {
  const { dict, fmt } = useI18n();
  const showToast = useUiStore((s) => s.showToast);

  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const info = await tauriClient.appCheckUpdateInfo();
      setUpdateInfo(info);
    } catch (err) {
      showToast({
        label: dict.settings.appVersion,
        text: err instanceof Error ? err.message : 'Failed',
        kind: 'warning',
      });
    } finally {
      setCheckingUpdate(false);
    }
  }, [dict.settings.appVersion, showToast]);

  useEffect(() => {
    if (autoCheckUpdate) {
      void handleCheckUpdate();
    }
  }, [autoCheckUpdate, handleCheckUpdate]);

  const versionText = updateInfo ? `v${updateInfo.currentVersion}` : 'v0.1.5';

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center gap-3.5 p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
        <img
          src="/logo.png"
          alt="Keysmith"
          className="w-12 h-12 rounded-xl object-cover shrink-0 border border-[var(--border-subtle)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-[var(--text-primary)] tracking-tight">
              Keysmith
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-selected)] text-[var(--accent-primary)] font-mono-tabular text-xs font-medium">
              {versionText}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
            {dict.about.tagline}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{dict.about.authorLabel}</span>
          <button
            type="button"
            onClick={() => void openExternalUrl(AUTHOR_URL)}
            className="inline-flex items-center gap-1 font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
          >
            <span>chrisyer</span>
            <ExternalLink size={12} />
          </button>
        </div>

        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{dict.about.repositoryLabel}</span>
          <button
            type="button"
            onClick={() => void openExternalUrl(REPO_URL)}
            className="inline-flex items-center gap-1 font-mono-tabular text-xs text-[var(--accent-primary)] hover:underline cursor-pointer truncate"
          >
            <span className="truncate">github.com/chrisyer/Keysmith</span>
            <ExternalLink size={12} className="shrink-0" />
          </button>
        </div>

        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{dict.about.stackLabel}</span>
          <span className="inline-flex items-center gap-1.5 font-mono-tabular text-xs text-[var(--text-primary)]">
            <Layers size={12} className="text-[var(--text-muted)]" />
            Rust · Tauri v2 · React 19
          </span>
        </div>

        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{dict.about.protocolLabel}</span>
          <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)] font-medium">
            <Shield size={12} className="text-[var(--text-muted)]" />
            Bitwarden / Vaultwarden
          </span>
        </div>

        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[var(--text-secondary)]">{dict.about.copyrightLabel}</span>
          <span className="text-[var(--text-muted)] font-mono-tabular text-xs">© 2026 chrisyer</span>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text-primary)]">{dict.about.versionLabel}</div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono-tabular">{versionText}</span>
            {updateInfo && !updateInfo.updateAvailable && (
              <span className="inline-flex items-center gap-1 text-[var(--status-success)] font-medium">
                <CheckCircle2 size={13} />
                {dict.about.upToDate}
              </span>
            )}
            {updateInfo?.updateAvailable && updateInfo.latestVersion && (
              <span className="px-2 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent-primary)] font-medium">
                {fmt(dict.settings.newVersionAvailable, { version: updateInfo.latestVersion })}
              </span>
            )}
          </div>
          {updateInfo?.updateAvailable && updateInfo.notes && (
            <div className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
              {updateInfo.notes}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {updateInfo?.updateAvailable && updateInfo.releaseUrl && (
            <button
              type="button"
              onClick={() => void openExternalUrl(updateInfo.releaseUrl!)}
              className="px-3 py-2 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-medium cursor-pointer"
            >
              {dict.settings.download}
            </button>
          )}
          <button
            type="button"
            disabled={checkingUpdate}
            onClick={() => void handleCheckUpdate()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
          >
            <RefreshCw size={13} className={checkingUpdate ? 'animate-spin' : ''} />
            {checkingUpdate ? dict.settings.checkingUpdate : dict.settings.checkUpdate}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void openExternalUrl(REPO_URL)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
        >
          <Globe size={13} />
          {dict.about.openRepo}
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(RELEASES_URL)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
        >
          <KeyRound size={13} />
          {dict.about.releases}
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(ISSUES_URL)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
        >
          <ExternalLink size={13} />
          {dict.about.reportIssue}
        </button>
      </div>
    </div>
  );
}

export function AboutModal() {
  const { dict } = useI18n();
  const open = useUiStore((s) => s.aboutOpen);
  const autoCheck = useUiStore((s) => s.aboutAutoCheck);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);

  return (
    <ModalDialog
      open={open}
      onClose={() => setAboutOpen(false)}
      ariaLabelledBy="about-modal-title"
      closedBy="any"
      className="rounded-xl w-[min(480px,92vw)] shadow-2xl"
    >
      <div className="flex flex-col max-h-[85dvh]">
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h1 id="about-modal-title" className="text-base font-semibold text-[var(--text-primary)]">
            {dict.about.title}
          </h1>
          <button
            type="button"
            onClick={() => setAboutOpen(false)}
            aria-label={dict.common.close}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto ks-scroll">
          <AboutContent autoCheckUpdate={autoCheck} />
        </div>
      </div>
    </ModalDialog>
  );
}
