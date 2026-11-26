import { useUiStore } from '../stores/uiStore';
import type { LanguageMode } from '../types/domain';
import { en } from './en';
import { zhCN } from './zh-CN';

export type Locale = 'zh-CN' | 'en';
export type { LanguageMode };

const LANG_STORAGE_KEY = 'keysmith:language';

export function readStoredLanguage(): LanguageMode {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    if (v === 'zh-CN' || v === 'en' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}

export function writeStoredLanguage(mode: LanguageMode): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function resolveLocale(mode: LanguageMode): Locale {
  if (mode === 'zh-CN' || mode === 'en') return mode;
  if (typeof navigator !== 'undefined') {
    const lang = (navigator.language || '').toLowerCase();
    return lang.startsWith('zh') ? 'zh-CN' : 'en';
  }
  return 'zh-CN';
}

export function getDictionary(locale: Locale) {
  return locale === 'en' ? en : zhCN;
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
  return {
    languageMode,
    setLanguageMode,
    locale,
    dict,
    fmt: formatMessage,
  };
}
