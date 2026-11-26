import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  formatMessage,
  getDictionary,
  isValidLanguageMode,
  resolveLocale,
} from '../i18n';

function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
      expect(typeof v, `${path} should be string`).toBe('string');
      expect((v as string).trim().length, `${path} should not be empty`).toBeGreaterThan(0);
    }
  }
  return keys.sort();
}

describe('Desktop i18n dictionaries', () => {
  it('supports all 8 locales with identical leaf key coverage as English', () => {
    expect(SUPPORTED_LOCALES.map((l) => l.id)).toEqual([
      'en',
      'zh-CN',
      'zh-TW',
      'ja',
      'ko',
      'de',
      'fr',
      'es',
    ]);

    const baseKeys = collectLeafKeys(getDictionary('en') as unknown as Record<string, unknown>);
    for (const loc of SUPPORTED_LOCALES) {
      const dict = getDictionary(loc.id);
      const keys = collectLeafKeys(dict as unknown as Record<string, unknown>);
      expect(keys, `key mismatch for locale ${loc.id}`).toEqual(baseKeys);
    }
  });

  it('validates language modes and resolves explicit locales', () => {
    expect(isValidLanguageMode('system')).toBe(true);
    expect(isValidLanguageMode('ja')).toBe(true);
    expect(isValidLanguageMode('unknown')).toBe(false);
    expect(resolveLocale('de')).toBe('de');
    expect(formatMessage('New version v{version}', { version: '0.2.0' })).toBe('New version v0.2.0');
  });
});
