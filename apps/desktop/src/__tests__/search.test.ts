import { describe, expect, it } from 'vitest';
import { matchesSearchQuery, parseSearchQuery, scoreSearchQuery } from '../services/search';
import type { ItemDetail, Vault } from '../types/domain';

const VAULTS: Vault[] = [
  {
    id: 'personal',
    name: '个人',
    icon: 'user',
    color: '#0572EC',
    isDefault: true,
    itemCount: 2,
  },
  {
    id: 'work',
    name: '工作',
    icon: 'briefcase',
    color: '#6366F1',
    isDefault: false,
    itemCount: 1,
  },
];

const ITEMS: ItemDetail[] = [
  {
    id: '1',
    schema: 'keysmith.item.v1',
    vaultId: 'personal',
    title: 'GitHub',
    favorite: true,
    category: 'login',
    tags: ['dev', 'code'],
    urls: [{ id: 'u1', uri: 'https://github.com/login', matchRule: 'domain' }],
    sections: [
      {
        id: 's1',
        title: 'Login',
        fields: [
          {
            id: 'f1',
            label: 'Username',
            fieldType: 'text',
            value: 'alice@example.com',
            sensitive: false,
            copyable: true,
            purpose: 'username',
          },
        ],
      },
    ],
    passkeys: [
      {
        credentialId: 'cred-1',
        rpId: 'github.com',
        rpName: 'GitHub',
        userHandle: 'MQ',
        userName: 'alice@example.com',
        userDisplayName: 'Alice',
        algorithm: -7,
        privateKeyPkcs8: '',
        publicKeySpki: '',
        signCount: 3,
        discoverable: true,
        aaguid: '',
        transports: ['internal'],
        backedUp: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    notes: 'Primary developer account',
    passwordHistory: [],
    watchtower: {
      ignoreWeak: false,
      ignoreReused: false,
      ignoreMissing2fa: false,
      ignoreUnsecuredUrl: false,
    },
    archived: false,
    reprompt: false,
    attachments: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    schema: 'keysmith.item.v1',
    vaultId: 'work',
    title: '招商银行信用卡',
    favorite: false,
    category: 'credit_card',
    tags: ['finance'],
    urls: [{ id: 'u2', uri: 'https://cmbchina.com', matchRule: 'domain' }],
    sections: [],
    passkeys: [],
    notes: 'Corp card',
    passwordHistory: [],
    watchtower: {
      ignoreWeak: false,
      ignoreReused: false,
      ignoreMissing2fa: false,
      ignoreUnsecuredUrl: false,
    },
    archived: false,
    reprompt: false,
    attachments: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

describe('Search parser and scoring', () => {
  it('parses structured prefixes accurately', () => {
    const parsed = parseSearchQuery('tag:dev vault:gr cat:login is:fav is:passkey github');
    expect(parsed.tags).toEqual(['dev']);
    expect(parsed.vaults).toEqual(['gr']);
    expect(parsed.categories).toEqual(['login']);
    expect(parsed.favoriteOnly).toBe(true);
    expect(parsed.passkeyOnly).toBe(true);
    expect(parsed.freeTerms).toEqual(['github']);
  });

  it('supports pinyin matching and excludes email-domain noise', () => {
    expect(matchesSearchQuery(ITEMS[1], VAULTS, 'zsyh')).toBe(true);
    expect(matchesSearchQuery(ITEMS[1], VAULTS, 'vault:gz')).toBe(true);
    // Searching "example" should not noisily match alice@example.com unless domain query contains @
    expect(matchesSearchQuery(ITEMS[0], VAULTS, 'example')).toBe(false);
    expect(matchesSearchQuery(ITEMS[0], VAULTS, 'alice@example.com')).toBe(true);
  });

  it('ranks exact title match higher than domain match', () => {
    const exactScore = scoreSearchQuery(ITEMS[0], VAULTS, 'github')!;
    const noteScore = scoreSearchQuery(ITEMS[0], VAULTS, 'developer')!;
    expect(exactScore).toBeGreaterThan(noteScore);
  });
});
