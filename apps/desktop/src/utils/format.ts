import { getIntlLocale, readStoredLanguage, resolveLocale, type Locale } from '../i18n';
import type { ItemPayload } from '../types/domain';

const NO_SUBTITLE_BY_LOCALE: Record<Locale, string> = {
  en: 'No subtitle',
  'zh-CN': '无副标题',
  'zh-TW': '無副標題',
  ja: 'サブタイトルなし',
  ko: '부제 없음',
  de: 'Kein Untertitel',
  fr: 'Sans sous-titre',
  es: 'Sin subtítulo',
};

const JUST_NOW_BY_LOCALE: Record<Locale, string> = {
  en: 'Just now',
  'zh-CN': '刚刚',
  'zh-TW': '剛剛',
  ja: 'たった今',
  ko: '방금 전',
  de: 'Gerade eben',
  fr: 'À l’instant',
  es: 'Ahora mismo',
};

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const intlLocale = getIntlLocale(resolveLocale(readStoredLanguage()));
    return d.toLocaleString(intlLocale, {
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
  const locale = resolveLocale(readStoredLanguage());
  const intlLocale = getIntlLocale(locale);
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return JUST_NOW_BY_LOCALE[locale];
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 10) return JUST_NOW_BY_LOCALE[locale];
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'always', style: 'short' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return rtf.format(-diffHr, 'hour');
  const diffDay = Math.floor(diffHr / 24);
  return rtf.format(-diffDay, 'day');
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

  return NO_SUBTITLE_BY_LOCALE[resolveLocale(readStoredLanguage())];
}

export function makeId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
