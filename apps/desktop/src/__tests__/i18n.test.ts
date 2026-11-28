import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  formatMessage,
  getDictionary,
  isValidLanguageMode,
  localizeBuiltinFieldLabel,
  localizeBuiltinSectionTitle,
  resolveLocale,
} from '../i18n';
import { createEmptyDraft } from '../services/templates';
import { formatShortcut } from '../utils/shortcuts';

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

  it('localizes new item template labels according to active locale', () => {
    const zhLogin = createEmptyDraft('login', 'vault-personal', 'zh-CN');
    expect(zhLogin.urls[0]?.label).toBe('登录页');
    expect(zhLogin.sections[0]?.fields.map((f) => f.label)).toEqual([
      '用户名',
      '密码',
      '一次性验证码 (2FA)',
    ]);

    const enLogin = createEmptyDraft('login', 'vault-personal', 'en');
    expect(enLogin.urls[0]?.label).toBe('Login Page');
    expect(enLogin.sections[0]?.fields.map((f) => f.label)).toEqual([
      'Username',
      'Password',
      'One-Time Password',
    ]);

    for (const loc of SUPPORTED_LOCALES) {
      for (const category of ['login', 'credit_card', 'ssh_key'] as const) {
        const draft = createEmptyDraft(category, 'vault-personal', loc.id);
        expect(draft.sections[0]?.fields.length).toBeGreaterThan(0);
        for (const f of draft.sections.flatMap((s) => s.fields)) {
          expect(f.label.trim().length, `${loc.id}.${category} field label non-empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('localizes built-in decoded field labels and section titles while keeping custom labels intact', () => {
    const en = getDictionary('en');
    expect(localizeBuiltinFieldLabel('用户名', en)).toBe('Username');
    expect(localizeBuiltinFieldLabel('密码', en)).toBe('Password');
    expect(localizeBuiltinFieldLabel('一次性密码', en)).toBe('One-Time Password');
    expect(localizeBuiltinFieldLabel('', en, 'username')).toBe('Username');
    expect(localizeBuiltinFieldLabel('API Recovery Seed', en)).toBe('API Recovery Seed');
    expect(localizeBuiltinSectionTitle('自定义字段', en)).toBe('Custom Fields');
    expect(localizeBuiltinSectionTitle('Custom Section', en)).toBe('Custom Section');

    const ja = getDictionary('ja');
    expect(localizeBuiltinFieldLabel('Username', ja)).toBe(ja.templates.fields.username);
    expect(localizeBuiltinSectionTitle('卡片信息', ja)).toBe(ja.templates.sections.billingBank);
  });

  it('formats shortcuts cleanly for both macOS and Linux/Windows platforms', () => {
    expect(formatShortcut('CommandOrControl+Shift+Space', 'mac')).toBe('⌘⇧Space');
    expect(formatShortcut('CommandOrControl+Shift+Space', 'other')).toBe('Ctrl+Shift+Space');
    expect(formatShortcut('CommandOrControl+,', 'mac')).toBe('⌘,');
    expect(formatShortcut('CommandOrControl+,', 'other')).toBe('Ctrl+,');
    expect(formatShortcut('CommandOrControl+Shift+Enter', 'mac')).toBe('⌘⇧⏎');
    expect(formatShortcut('CommandOrControl+Shift+Enter', 'other')).toBe('Ctrl+Shift+Enter');
    expect(formatShortcut('Alt+Enter', 'other')).toBe('Alt+Enter');
  });
});
