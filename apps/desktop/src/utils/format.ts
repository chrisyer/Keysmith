import { readStoredLanguage, resolveLocale } from '../i18n';
import type { ItemPayload } from '../types/domain';

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const locale = resolveLocale(readStoredLanguage()) === 'en' ? 'en-US' : 'zh-CN';
    return d.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso: string): string {
  const isEn = resolveLocale(readStoredLanguage()) === 'en';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return isEn ? 'Just now' : '刚刚';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 10) return isEn ? 'Just now' : '刚刚';
  if (diffSec < 60) return isEn ? `${diffSec}s ago` : `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return isEn ? `${diffMin}m ago` : `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isEn ? `${diffHr}h ago` : `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return isEn ? `${diffDay}d ago` : `${diffDay} 天前`;
}

export function extractDomain(uri: string): string {
  try {
    const u = new URL(uri.includes('://') ? uri : `https://${uri}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

export function maskCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '•••• ••••';
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.replace(/(.{4})/g, '$1 ').trim() || raw;
}

export function deriveSubtitle(payload: Pick<ItemPayload, 'category' | 'subtitle' | 'sections' | 'urls' | 'notes'>): string {
  if (payload.subtitle && payload.subtitle.trim()) {
    return payload.subtitle.trim();
  }
  const allFields = payload.sections.flatMap((s) => s.fields);
  const username = allFields.find((f) => f.purpose === 'username' && f.value.trim())?.value.trim();
  if (username) return username;

  if (payload.category === 'credit_card') {
    const cardNum = allFields.find((f) => f.purpose === 'card_number' && f.value.trim())?.value.trim();
    if (cardNum) return maskCardNumber(cardNum);
  }

  const firstVisible = allFields.find((f) => !f.sensitive && f.value.trim());
  if (firstVisible) return firstVisible.value.trim();

  if (payload.urls[0]?.uri) {
    return extractDomain(payload.urls[0].uri);
  }

  if (payload.notes.trim()) {
    return payload.notes.trim().split('\n')[0].slice(0, 42);
  }

  return '无副标题';
}

export function makeId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
