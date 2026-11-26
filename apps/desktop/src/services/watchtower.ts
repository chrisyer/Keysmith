import type { ItemDetail, WatchtowerIssueType, WatchtowerReport } from '../types/domain';
import { evaluatePasswordStrength } from './generator';

const KNOWN_BREACHED_SAMPLE = new Set([
  'Summer2024!',
  'Admin12345',
  '123456',
  'password',
  'qwerty',
  'LetMeIn2024!',
]);

const PASSKEY_CAPABLE_DOMAINS = new Set([
  'google.com',
  'youtube.com',
  'gmail.com',
  'apple.com',
  'icloud.com',
  'microsoft.com',
  'live.com',
  'outlook.com',
  'github.com',
  'gitlab.com',
  'amazon.com',
  'paypal.com',
  'x.com',
  'twitter.com',
  'cloudflare.com',
  'discord.com',
  'openai.com',
  'chatgpt.com',
  'notion.so',
  'figma.com',
  'vercel.com',
  'shopify.com',
  'stripe.com',
  'linkedin.com',
  'dropbox.com',
  '1password.com',
  'bitwarden.com',
]);

function extractRegistrableHost(uri: string): string {
  try {
    const candidate = uri.includes('://') ? uri : `https://${uri}`;
    const host = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : host;
  } catch {
    return '';
  }
}

function isLocalOrIntranetHost(uri: string): boolean {
  try {
    const u = new URL(uri);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
      return true;
    }
    if (host.startsWith('10.') || host.startsWith('192.168.')) {
      return true;
    }
    const m = /^172\.(\d+)\./.exec(host);
    if (m) {
      const second = Number(m[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isExpiringOrExpired(value: string, now: Date): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  let expiryDate: Date | null = null;
  if (/^\d{4}[-/]\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split(/[-/]/).map(Number);
    expiryDate = new Date(y, m, 0, 23, 59, 59);
  } else if (/^\d{1,2}[-/](\d{2}|\d{4})$/.test(trimmed)) {
    const [rawM, rawY] = trimmed.split(/[-/]/);
    const m = Number(rawM);
    const y = rawY.length === 2 ? 2000 + Number(rawY) : Number(rawY);
    if (m >= 1 && m <= 12) {
      expiryDate = new Date(y, m, 0, 23, 59, 59);
    }
  } else if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(trimmed)) {
    const d = new Date(trimmed.slice(0, 10).replace(/\//g, '-'));
    if (!Number.isNaN(d.getTime())) expiryDate = d;
  }
  if (!expiryDate) return false;

  const threshold = new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000);
  return expiryDate.getTime() <= threshold.getTime();
}

export async function sha1PrefixHex(secret: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(secret);
      const digest = await crypto.subtle.digest('SHA-1', encoded);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      return hex.slice(0, 5);
    }
  } catch {
    // ignore
  }
  return '00000';
}

export function runWatchtowerAudit(
  items: ItemDetail[],
  options: { checkHibp?: boolean; hibpCheckedAt?: string } = {},
): WatchtowerReport {
  const activeItems = items.filter((item) => !item.deletedAt);
  const now = new Date();

  const itemIdsByIssue: Record<WatchtowerIssueType, string[]> = {
    weak: [],
    reused: [],
    missing_2fa: [],
    unsecured_url: [],
    expiring: [],
    breached: [],
    passkey_available: [],
  };

  const itemIssueSets: Record<string, Set<WatchtowerIssueType>> = {};
  const addIssue = (itemId: string, issue: WatchtowerIssueType) => {
    if (!itemIssueSets[itemId]) itemIssueSets[itemId] = new Set();
    if (!itemIssueSets[itemId].has(issue)) {
      itemIssueSets[itemId].add(issue);
      itemIdsByIssue[issue].push(itemId);
    }
  };

  const passwordBuckets = new Map<string, string[]>();

  for (const item of activeItems) {
    const fields = item.sections.flatMap((s) => s.fields);

    // 1. Weak passwords & collect reuse buckets
    for (const field of fields) {
      if (field.purpose === 'password' && field.value.trim()) {
        const val = field.value;
        if (!item.watchtower.ignoreWeak) {
          const strength = evaluatePasswordStrength(val);
          if (strength.score < 3) {
            addIssue(item.id, 'weak');
          }
        }
        if (!item.watchtower.ignoreReused) {
          const bucket = passwordBuckets.get(val) ?? [];
          if (!bucket.includes(item.id)) {
            bucket.push(item.id);
            passwordBuckets.set(val, bucket);
          }
        }
        if (options.checkHibp && KNOWN_BREACHED_SAMPLE.has(val)) {
          addIssue(item.id, 'breached');
        }
      }

      // 5. Expiring / expired dates & card expiry
      if (
        !item.watchtower.ignoreExpiring &&
        (field.purpose === 'card_expiry' ||
          field.fieldType === 'month_year' ||
          (field.fieldType === 'date' && /(到期|过期|有效期|expiry|expir)/i.test(field.label))) &&
        isExpiringOrExpired(field.value, now)
      ) {
        addIssue(item.id, 'expiring');
      }
    }

    // 3. Missing 2FA & Passkey upgrade availability for Login items with URLs
    if (item.category === 'login') {
      const hasValidUrl = item.urls.some((u) => u.uri.trim().length > 0);
      const hasTotp = fields.some((f) => f.fieldType === 'totp' && f.value.trim().length > 0);
      const hasPasskey = (item.passkeys?.length ?? 0) > 0;
      const hasSso = Boolean(item.ssoProvider?.trim());
      if (!item.watchtower.ignoreMissing2fa && hasValidUrl && !hasTotp && !hasPasskey && !hasSso) {
        addIssue(item.id, 'missing_2fa');
      }
      if (
        !item.watchtower.ignorePasskeyAvailable &&
        !hasPasskey &&
        !hasSso &&
        item.urls.some((u) => PASSKEY_CAPABLE_DOMAINS.has(extractRegistrableHost(u.uri)))
      ) {
        addIssue(item.id, 'passkey_available');
      }
    }

    // 4. Unsecured HTTP URLs
    if (!item.watchtower.ignoreUnsecuredUrl) {
      const hasInsecure = item.urls.some(
        (u) => u.uri.trim().toLowerCase().startsWith('http://') && !isLocalOrIntranetHost(u.uri.trim()),
      );
      if (hasInsecure) {
        addIssue(item.id, 'unsecured_url');
      }
    }
  }

  // 2. Reused passwords
  for (const [, itemIds] of passwordBuckets) {
    if (itemIds.length >= 2) {
      for (const id of itemIds) {
        addIssue(id, 'reused');
      }
    }
  }

  const itemIssues: Record<string, WatchtowerIssueType[]> = {};
  for (const [id, set] of Object.entries(itemIssueSets)) {
    itemIssues[id] = Array.from(set);
  }

  const penalty =
    itemIdsByIssue.breached.length * 14 +
    itemIdsByIssue.weak.length * 10 +
    itemIdsByIssue.reused.length * 7 +
    itemIdsByIssue.missing_2fa.length * 4 +
    itemIdsByIssue.unsecured_url.length * 5 +
    itemIdsByIssue.expiring.length * 3 +
    itemIdsByIssue.passkey_available.length * 1;

  const score = Math.max(12, Math.min(100, 100 - penalty));

  return {
    score,
    totalAudited: activeItems.length,
    totalRiskItems: Object.keys(itemIssues).length,
    counts: {
      weak: itemIdsByIssue.weak.length,
      reused: itemIdsByIssue.reused.length,
      missing_2fa: itemIdsByIssue.missing_2fa.length,
      unsecured_url: itemIdsByIssue.unsecured_url.length,
      expiring: itemIdsByIssue.expiring.length,
      breached: itemIdsByIssue.breached.length,
      passkey_available: itemIdsByIssue.passkey_available.length,
    },
    itemIdsByIssue,
    itemIssues,
    hibpChecked: Boolean(options.checkHibp),
    hibpCheckedAt: options.hibpCheckedAt,
  };
}
