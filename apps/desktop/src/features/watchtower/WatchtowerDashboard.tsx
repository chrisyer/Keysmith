import {
  AlertOctagon,
  CalendarClock,
  CopyCheck,
  GlobeLock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';
import type { WatchtowerIssueType } from '../../types/domain';
import { formatRelativeTime } from '../../utils/format';

interface CardDef {
  issue: WatchtowerIssueType;
  title: string;
  subtitle: string;
  severity: '极危' | '高危' | '中危' | '低危' | '提示';
  color: string;
  icon: typeof ShieldAlert;
}

const CARDS: CardDef[] = [
  {
    issue: 'weak',
    title: '弱密码',
    subtitle: '本地 zxcvbn 熵评分 < 3 的口令',
    severity: '高危',
    color: 'var(--status-danger)',
    icon: ShieldAlert,
  },
  {
    issue: 'reused',
    title: '重复使用的密码',
    subtitle: 'BLAKE3 内存加盐桶检测到的相同密码',
    severity: '高危',
    color: 'var(--status-danger)',
    icon: CopyCheck,
  },
  {
    issue: 'missing_2fa',
    title: '未开启 2FA',
    subtitle: '支持网站的登录条目尚未配置 TOTP',
    severity: '中危',
    color: 'var(--status-warning)',
    icon: Smartphone,
  },
  {
    issue: 'unsecured_url',
    title: '不安全 HTTP 连接',
    subtitle: '明文 http:// 网站（已排除内网与 localhost）',
    severity: '低危',
    color: 'var(--status-caution)',
    icon: GlobeLock,
  },
  {
    issue: 'expiring',
    title: '即将过期 / 已过期',
    subtitle: '银行卡或软件许可到期日在 30 天内',
    severity: '提示',
    color: 'var(--status-info)',
    icon: CalendarClock,
  },
  {
    issue: 'breached',
    title: '已泄露密码检测',
    subtitle: 'k-匿名仅发送 SHA-1 前 5 位前缀查询 HIBP',
    severity: '极危',
    color: 'var(--status-danger)',
    icon: AlertOctagon,
  },
];

export function WatchtowerDashboard() {
  const report = useVaultStore((s) => s.watchtowerReport);
  const hibpScanning = useVaultStore((s) => s.hibpScanning);
  const runHibpScan = useVaultStore((s) => s.runHibpScan);
  const getFilter = useUiStore((s) => s.getFilter);
  const setWatchtowerIssueFilter = useUiStore((s) => s.setWatchtowerIssueFilter);
  const showToast = useUiStore((s) => s.showToast);

  if (!report) return null;

  const score = report.score;
  const radius = 50;
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
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {/* Top Score Summary Card */}
        <div className="p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
            <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
              <circle
                cx="64"
                cy="64"
                r={radius}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth="10"
              />
              <circle
                cx="64"
                cy="64"
                r={radius}
                fill="none"
                stroke={scoreColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-tabular text-3xl font-bold text-[var(--text-primary)]">
                {score}
              </span>
              <span className="text-[10px] font-medium text-[var(--text-muted)]">安全评分</span>
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--bg-detail)] border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)]">
              <ShieldCheck size={13} className="text-[var(--accent-primary)]" />
              本地零知识内存审计 · 已扫描 {report.totalAudited} 个活跃条目
            </div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)] mt-2">
              Watchtower 安全体检中心
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
              当前共发现 <strong className="text-[var(--text-primary)]">{report.totalRiskItems}</strong> 个存在潜在风险的条目。点击下方任意分类卡片，即可在中间栏聚焦并逐一修复；修复后评分实时回升。
            </p>
          </div>
        </div>

        {/* 6 Audit Category Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {CARDS.map((card) => {
            const count = report.counts[card.issue];
            const Icon = card.icon;
            const isBreachCard = card.issue === 'breached';

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
                      showToast({ label: card.title, text: `「${card.title}」当前无异常条目`, kind: 'info' });
                    }
                  }}
                  className="text-left flex items-start justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${card.color} 14%, transparent)`,
                        color: card.color,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {card.title}
                        </span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${card.color} 14%, transparent)`,
                            color: card.color,
                          }}
                        >
                          {card.severity}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {card.subtitle}
                      </p>
                    </div>
                  </div>

                  <span
                    className="font-mono-tabular text-xl font-bold shrink-0"
                    style={{ color: count > 0 ? card.color : 'var(--status-success)' }}
                  >
                    {isBreachCard && !report.hibpChecked ? '—' : count}
                  </span>
                </button>

                {isBreachCard && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {report.hibpChecked && report.hibpCheckedAt
                        ? `已核验 (${formatRelativeTime(report.hibpCheckedAt)}) · 仅发送 5 位前缀`
                        : '默认关闭外网查询，需显式授权'}
                    </span>
                    <button
                      type="button"
                      disabled={hibpScanning}
                      onClick={() => void runHibpScan(getFilter())}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-60 text-[11px] font-medium text-white cursor-pointer"
                    >
                      {hibpScanning && <Loader2 size={11} className="animate-spin" />}
                      {hibpScanning ? 'k-匿名检测中...' : report.hibpChecked ? '重新检测' : '检查已泄露密码'}
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
