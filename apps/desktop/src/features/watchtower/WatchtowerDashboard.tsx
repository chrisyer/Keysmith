import {
  AlertOctagon,
  CalendarClock,
  CopyCheck,
  Fingerprint,
  GlobeLock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { WatchtowerIssueType } from '../../types/domain';
import { formatRelativeTime } from '../../utils/format';

const CARD_META: Array<{
  issue: WatchtowerIssueType;
  color: string;
  icon: typeof ShieldAlert;
}> = [
  { issue: 'weak', color: 'var(--status-danger)', icon: ShieldAlert },
  { issue: 'reused', color: 'var(--status-danger)', icon: CopyCheck },
  { issue: 'missing_2fa', color: 'var(--status-warning)', icon: Smartphone },
  { issue: 'unsecured_url', color: 'var(--status-caution)', icon: GlobeLock },
  { issue: 'expiring', color: 'var(--status-info)', icon: CalendarClock },
  { issue: 'passkey_available', color: 'var(--accent-primary)', icon: Fingerprint },
  { issue: 'breached', color: 'var(--status-danger)', icon: AlertOctagon },
];

export function WatchtowerDashboard() {
  const { dict, fmt } = useI18n();
  const report = useVaultStore((s) => s.watchtowerReport);
  const hibpScanning = useVaultStore((s) => s.hibpScanning);
  const runHibpScan = useVaultStore((s) => s.runHibpScan);
  const getFilter = useUiStore((s) => s.getFilter);
  const setWatchtowerIssueFilter = useUiStore((s) => s.setWatchtowerIssueFilter);
  const showToast = useUiStore((s) => s.showToast);

  if (!report) return null;

  const score = report.score;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const scoreColor =
    score >= 85
      ? 'var(--status-success)'
      : score >= 60
        ? 'var(--status-warning)'
        : 'var(--status-danger)';

  return (
    <div className="h-full overflow-y-auto ks-scroll bg-[var(--bg-detail)] p-7">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        <div className="p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth="8"
              />
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke={scoreColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-tabular text-2xl font-bold text-[var(--text-primary)]">
                {score}
              </span>
              <span className="text-[10px] font-medium text-[var(--text-muted)]">
                {dict.watchtower.scoreLabel}
              </span>
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
              <ShieldCheck size={13} className="text-[var(--accent-primary)]" />
              {fmt(dict.watchtower.auditedBadge, { count: report.totalAudited })}
            </div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)] mt-1">
              {dict.watchtower.title}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
              {fmt(dict.watchtower.subtitle, { count: report.totalRiskItems })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CARD_META.map((card) => {
            const count = report.counts[card.issue] ?? 0;
            const Icon = card.icon;
            const isBreachCard = card.issue === 'breached';
            const copy = dict.watchtower.cards[card.issue];

            return (
              <div
                key={card.issue}
                className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] transition-colors flex flex-col justify-between gap-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (count > 0) {
                      setWatchtowerIssueFilter(card.issue);
                    } else if (isBreachCard && !report.hibpChecked) {
                      void runHibpScan(getFilter());
                    } else {
                      showToast({
                        label: copy.title,
                        text: fmt(dict.watchtower.cleanToast, { title: copy.title }),
                        kind: 'info',
                      });
                    }
                  }}
                  className="text-left flex items-start justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${card.color} 14%, transparent)`,
                        color: card.color,
                      }}
                    >
                      <Icon size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                          {copy.title}
                        </span>
                        <span
                          className="px-1.5 py-0.2 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${card.color} 14%, transparent)`,
                            color: card.color,
                          }}
                        >
                          {copy.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {copy.subtitle}
                      </p>
                    </div>
                  </div>

                  <span
                    className="font-mono-tabular text-lg font-bold shrink-0"
                    style={{ color: count > 0 ? card.color : 'var(--status-success)' }}
                  >
                    {isBreachCard && !report.hibpChecked ? '—' : count}
                  </span>
                </button>

                {isBreachCard && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-[var(--text-muted)]">
                      {report.hibpChecked && report.hibpCheckedAt
                        ? fmt(dict.watchtower.checkedAt, { time: formatRelativeTime(report.hibpCheckedAt) })
                        : dict.watchtower.neverChecked}
                    </span>
                    <button
                      type="button"
                      disabled={hibpScanning}
                      onClick={() => void runHibpScan(getFilter())}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-[11px] font-medium text-white cursor-pointer"
                    >
                      {hibpScanning && <Loader2 size={11} className="animate-spin" />}
                      {hibpScanning
                        ? dict.watchtower.checkingBreach
                        : report.hibpChecked
                          ? dict.watchtower.recheckBreachBtn
                          : dict.watchtower.checkBreachBtn}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
