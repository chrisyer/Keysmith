import { useUiStore } from '../stores/uiStore';
import type { LanguageMode } from '../types/domain';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr' | 'es';
export type { LanguageMode };

export type DeepString<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>;
};
export type Dictionary = DeepString<typeof en>;

export const SUPPORTED_LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
];

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES.map((l) => l.id));

const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  de,
  fr,
  es,
};

const LANG_STORAGE_KEY = 'keysmith:language';

export function isValidLanguageMode(value: string | null | undefined): value is LanguageMode {
  return value === 'system' || (typeof value === 'string' && LOCALE_SET.has(value));
}

export function readStoredLanguage(): LanguageMode {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    if (isValidLanguageMode(v)) return v;
  } catch {
    // ignore
  }
  return 'en';
}

export function writeStoredLanguage(mode: LanguageMode): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function resolveLocale(mode: LanguageMode): Locale {
  if (mode !== 'system' && LOCALE_SET.has(mode)) {
    return mode as Locale;
  }
  if (typeof navigator !== 'undefined') {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.startsWith('zh-hant')) {
      return 'zh-TW';
    }
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('fr')) return 'fr';
    if (lang.startsWith('es')) return 'es';
  }
  return 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en;
}

export function getIntlLocale(locale: Locale): string {
  switch (locale) {
    case 'zh-CN':
      return 'zh-CN';
    case 'zh-TW':
      return 'zh-TW';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return 'en-US';
  }
}

export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

export function useI18n() {
  const languageMode = useUiStore((s) => s.languageMode);
  const setLanguageMode = useUiStore((s) => s.setLanguageMode);
  const locale = resolveLocale(languageMode);
  const dict = getDictionary(locale);
  if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
    document.documentElement.lang = locale;
  }
  return {
    languageMode,
    setLanguageMode,
    locale,
    dict,
    fmt: formatMessage,
  };
}
