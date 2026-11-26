import { describe, expect, it } from 'vitest';
import { matchesSearchQuery, parseSearchQuery } from '../services/search';
import { runWatchtowerAudit } from '../services/watchtower';
import type { ItemDetail, Vault } from '../types/domain';

const VAULTS: Vault[] = [
  {
    id: 'personal',
    name: 'Personal',
    icon: 'user',
    color: '#0572EC',
    isDefault: true,
    travelSafe: true,
    itemCount: 3,
  },
];

function makeBaseItem(overrides: Partial<ItemDetail>): ItemDetail {
  return {
    id: 'item-1',
    schema: 'keysmith.item.v1',
    vaultId: 'personal',
    title: 'Test Item',
    favorite: false,
    category: 'login',
    tags: [],
    urls: [],
    sections: [],
    passkeys: [],
    notes: '',
    passwordHistory: [],
    watchtower: {
      ignoreWeak: false,
      ignoreReused: false,
      ignoreMissing2fa: false,
      ignoreUnsecuredUrl: false,
      ignoreExpiring: false,
      ignorePasskeyAvailable: false,
    },
    archived: false,
    reprompt: false,
    attachments: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Watchtower active security & SSO / Linked search', () => {
  it('flags passkey_available on supported domains unless SSO or ignored', () => {
    const githubPasswordOnly = makeBaseItem({
      id: 'gh-1',
      title: 'GitHub',
      urls: [{ id: 'u1', uri: 'https://github.com/login', matchRule: 'domain' }],
      sections: [
        {
          id: 's1',
          title: 'Login',
          fields: [
            {
              id: 'f1',
              label: 'Password',
              fieldType: 'password',
              value: 'X9$mK2!qP8@vL4#nR7',
              sensitive: true,
              copyable: true,
              purpose: 'password',
            },
          ],
        },
      ],
    });

    const googleSsoItem = makeBaseItem({
      id: 'sso-1',
      title: 'Figma',
      ssoProvider: 'Google',
      urls: [{ id: 'u2', uri: 'https://www.figma.com', matchRule: 'domain' }],
    });

    const expiredCard = makeBaseItem({
      id: 'card-1',
      title: 'Corp Card',
      category: 'credit_card',
      sections: [
        {
          id: 'sc',
          title: 'Card',
          fields: [
            {
              id: 'fe',
              label: 'Expiry',
              fieldType: 'text',
              value: '02/21',
              sensitive: false,
              copyable: true,
              purpose: 'card_expiry',
            },
          ],
        },
      ],
    });

    const report = runWatchtowerAudit([githubPasswordOnly, googleSsoItem, expiredCard]);
    expect(report.counts.passkey_available).toBe(1);
    expect(report.itemIssues['gh-1']).toContain('passkey_available');
    expect(report.itemIssues['gh-1']).toContain('missing_2fa');
    expect(report.itemIssues['sso-1']).toBeUndefined();
    expect(report.itemIssues['card-1']).toContain('expiring');

    // Respects ignorePasskeyAvailable & ignoreExpiring
    const ignoredGh = {
      ...githubPasswordOnly,
      watchtower: { ...githubPasswordOnly.watchtower, ignorePasskeyAvailable: true },
    };
    const ignoredCard = {
      ...expiredCard,
      watchtower: { ...expiredCard.watchtower, ignoreExpiring: true },
    };
    const report2 = runWatchtowerAudit([ignoredGh, ignoredCard]);
    expect(report2.counts.passkey_available).toBe(0);
    expect(report2.counts.expiring).toBe(0);
  });

  it('parses and filters is:sso, sso:<provider>, and is:linked search tokens', () => {
    const ssoItem = makeBaseItem({
      id: '10',
      title: 'Linear',
      ssoProvider: 'Okta',
      linkedItemIds: ['20'],
    });
    const plainItem = makeBaseItem({
      id: '11',
      title: 'Plain Login',
    });

    const parsed = parseSearchQuery('is:sso sso:okta is:linked');
    expect(parsed.ssoOnly).toBe(true);
    expect(parsed.ssoProviders).toEqual(['okta']);
    expect(parsed.linkedOnly).toBe(true);

    expect(matchesSearchQuery(ssoItem, VAULTS, 'is:sso')).toBe(true);
    expect(matchesSearchQuery(ssoItem, VAULTS, 'sso:okta')).toBe(true);
    expect(matchesSearchQuery(ssoItem, VAULTS, 'sso:google')).toBe(false);
    expect(matchesSearchQuery(ssoItem, VAULTS, 'is:linked')).toBe(true);
    expect(matchesSearchQuery(plainItem, VAULTS, 'is:sso')).toBe(false);
    expect(matchesSearchQuery(plainItem, VAULTS, 'is:linked')).toBe(false);
  });
});
