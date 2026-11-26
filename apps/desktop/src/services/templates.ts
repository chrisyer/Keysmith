import { getDictionary, readStoredLanguage, resolveLocale } from '../i18n';
import type { ItemCategory, ItemDraft } from '../types/domain';
import { makeId } from '../utils/format';

export interface TemplateMeta {
  category: ItemCategory;
  label: string;
  shortLabel: string;
  description: string;
  iconName: string;
  color: string;
  order: number;
  phase?: 1 | 2;
}

export const PHASE1_TEMPLATES: TemplateMeta[] = [
  {
    category: 'login',
    label: 'Login',
    shortLabel: 'Login',
    description: 'Websites & apps with username, password, TOTP and URLs',
    iconName: 'globe',
    color: '#0572EC',
    order: 1,
    phase: 1,
  },
  {
    category: 'password',
    label: 'Password',
    shortLabel: 'Password',
    description: 'Standalone passphrase or local encryption secret',
    iconName: 'key',
    color: '#7C3AED',
    order: 2,
    phase: 1,
  },
  {
    category: 'secure_note',
    label: 'Secure Note',
    shortLabel: 'Note',
    description: 'Encrypted Markdown text and private memos',
    iconName: 'file-text',
    color: '#D97706',
    order: 3,
    phase: 1,
  },
  {
    category: 'credit_card',
    label: 'Credit Card',
    shortLabel: 'Card',
    description: 'Credit/debit cards, expiration dates and CVV',
    iconName: 'credit-card',
    color: '#0D9488',
    order: 4,
    phase: 1,
  },
  {
    category: 'api_credential',
    label: 'API Credential',
    shortLabel: 'API',
    description: 'API key, secret, scope and endpoint URLs',
    iconName: 'webhook',
    color: '#2563EB',
    order: 5,
    phase: 1,
  },
  {
    category: 'database',
    label: 'Database',
    shortLabel: 'Database',
    description: 'PostgreSQL / MySQL / Redis connection credentials',
    iconName: 'database',
    color: '#0891B2',
    order: 6,
    phase: 1,
  },
  {
    category: 'server',
    label: 'Server',
    shortLabel: 'Server',
    description: 'Host IP, SSH port, root password and hosting panel',
    iconName: 'server',
    color: '#4F46E5',
    order: 7,
    phase: 1,
  },
  {
    category: 'ssh_key',
    label: 'SSH Key',
    shortLabel: 'SSH Key',
    description: 'Public key, private key, passphrase and SHA256 fingerprint',
    iconName: 'terminal',
    color: '#16A34A',
    order: 8,
    phase: 1,
  },
  {
    category: 'identity',
    label: 'Identity',
    shortLabel: 'Identity',
    description: 'Full name, contact details, address and ID numbers',
    iconName: 'user-check',
    color: '#DB2777',
    order: 9,
    phase: 1,
  },
  {
    category: 'software_license',
    label: 'Software License',
    shortLabel: 'License',
    description: 'License key, order ID and renewal/expiry dates',
    iconName: 'badge-check',
    color: '#EA580C',
    order: 10,
    phase: 1,
  },
];

export const PHASE2_TEMPLATES: TemplateMeta[] = [
  {
    category: 'bank_account',
    label: 'Bank Account',
    shortLabel: 'Bank',
    description: 'Bank name, account number, Routing / SWIFT and PIN',
    iconName: 'landmark',
    color: '#0F766E',
    order: 12,
    phase: 2,
  },
  {
    category: 'crypto_wallet',
    label: 'Crypto Wallet',
    shortLabel: 'Wallet',
    description: 'Seed phrase, wallet address, private key and passphrase',
    iconName: 'bitcoin',
    color: '#D97706',
    order: 13,
    phase: 2,
  },
  {
    category: 'wifi_router',
    label: 'Wi-Fi Router',
    shortLabel: 'Wi-Fi',
    description: 'SSID, Wi-Fi password, admin console and gateway IP',
    iconName: 'wifi',
    color: '#0284C7',
    order: 14,
    phase: 2,
  },
  {
    category: 'passport',
    label: 'Passport',
    shortLabel: 'Passport',
    description: 'Passport number, issuing country, issue and expiry dates',
    iconName: 'book-user',
    color: '#4338CA',
    order: 15,
    phase: 2,
  },
  {
    category: 'driver_license',
    label: 'Driver License',
    shortLabel: 'License',
    description: 'License number, class, issuing authority and expiry',
    iconName: 'car',
    color: '#2563EB',
    order: 16,
    phase: 2,
  },
  {
    category: 'membership',
    label: 'Membership',
    shortLabel: 'Member',
    description: 'Member ID, tier, PIN and renewal date',
    iconName: 'badge-percent',
    color: '#9333EA',
    order: 17,
    phase: 2,
  },
  {
    category: 'medical_record',
    label: 'Medical Record',
    shortLabel: 'Medical',
    description: 'Insurance ID, blood type, allergies and emergency contact',
    iconName: 'heart-pulse',
    color: '#E11D48',
    order: 18,
    phase: 2,
  },
  {
    category: 'document',
    label: 'Document',
    shortLabel: 'Document',
    description: 'Contracts, certificates, key files and encrypted archives',
    iconName: 'file-archive',
    color: '#475569',
    order: 19,
    phase: 2,
  },
];

export const ALL_TEMPLATES: TemplateMeta[] = [...PHASE1_TEMPLATES, ...PHASE2_TEMPLATES];

const PASSKEY_META: TemplateMeta = {
  category: 'passkey',
  label: 'Passkey',
  shortLabel: 'Passkey',
  description: 'Passwordless WebAuthn passkeys saved automatically during registration',
  iconName: 'fingerprint',
  color: '#0EA5E9',
  order: 11,
};

export const TEMPLATE_MAP: Record<ItemCategory, TemplateMeta> = {
  ...ALL_TEMPLATES.reduce(
    (acc, item) => {
      acc[item.category] = item;
      return acc;
    },
    {} as Record<ItemCategory, TemplateMeta>,
  ),
  passkey: PASSKEY_META,
};

export function createEmptyDraft(category: ItemCategory, vaultId: string): ItemDraft {
  const meta = TEMPLATE_MAP[category];
  const dict = getDictionary(resolveLocale(readStoredLanguage()));
  const catLabel = dict.categories[category] ?? meta.label;
  const base: ItemDraft = {
    vaultId,
    title: `${dict.newItem.title} · ${catLabel}`,
    favorite: false,
    archived: false,
    category,
    icon: { kind: 'preset', name: meta.iconName, color: meta.color },
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
    },
    attachments: [],
  };

  switch (category) {
    case 'login':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Login Page', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Username', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'One-Time Password', fieldType: 'totp', value: '', sensitive: true, copyable: true, purpose: 'totp' },
            ],
          },
        ],
      };

    case 'password':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Website', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
        ],
      };

    case 'secure_note':
      return {
        ...base,
        sections: [{ id: makeId('sec'), title: '', fields: [] }],
      };

    case 'credit_card':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Cardholder Name', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Card Number', fieldType: 'number', value: '', sensitive: true, copyable: true, purpose: 'card_number' },
              { id: makeId('f'), label: 'Expiration', fieldType: 'month_year', value: '', sensitive: false, copyable: true, purpose: 'card_expiry' },
              { id: makeId('f'), label: 'Security Code (CVV)', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'card_cvv' },
              { id: makeId('f'), label: 'Card Type', fieldType: 'text', value: 'Visa', sensitive: false, copyable: false },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Billing & Bank',
            fields: [
              { id: makeId('f'), label: 'Issuing Bank', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'ATM PIN', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
              { id: makeId('f'), label: 'Support Phone', fieldType: 'phone', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'identity':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Last Name', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'First Name', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Gender', fieldType: 'text', value: '', sensitive: false, copyable: false },
              { id: makeId('f'), label: 'Birth Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Company / Title', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Contact Information',
            fields: [
              { id: makeId('f'), label: 'Email', fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Phone', fieldType: 'phone', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Address', fieldType: 'address', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Identification',
            fields: [
              { id: makeId('f'), label: 'National ID / SSN', fieldType: 'password', value: '', sensitive: true, copyable: true },
            ],
          },
        ],
      };

    case 'api_credential':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Endpoint URL', matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Username / App ID', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'API Key', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'API Secret', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Permissions & Expiry',
            fields: [
              { id: makeId('f'), label: 'Scope', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Expiration Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'database':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Type', fieldType: 'text', value: 'PostgreSQL', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Host', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Port', fieldType: 'number', value: '5432', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Database', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Username', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Connection',
            fields: [
              { id: makeId('f'), label: 'Connection URI', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'SSL Mode', fieldType: 'text', value: 'require', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'server':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Control Panel', matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Host / IP', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Port', fieldType: 'number', value: '22', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Username', fieldType: 'text', value: 'root', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'Root / Admin Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Provider',
            fields: [
              { id: makeId('f'), label: 'Console Account', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Region / Datacenter', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'ssh_key':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Public Key', fieldType: 'ssh_public_key', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Private Key', fieldType: 'ssh_private_key', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Passphrase', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'Fingerprint', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'software_license':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Download Page', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'License Key', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Registered Email', fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Version', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: 'Purchase Details',
            fields: [
              { id: makeId('f'), label: 'Purchase Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Expiration Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Order Number', fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'passkey':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Website', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Relying Party ID (RP ID)', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Relying Party Name', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Account Username', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
            ],
          },
        ],
      };

    case 'bank_account':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Bank Name', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Account Holder', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Account Number / IBAN', fieldType: 'number', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Routing Number', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'SWIFT / BIC', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Phone Banking PIN', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
            ],
          },
        ],
      };

    case 'crypto_wallet':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Network / Asset', fieldType: 'text', value: 'Ethereum / BTC', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Wallet Address', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Seed Phrase', fieldType: 'multiline', value: '', sensitive: true, copyable: true, purpose: 'recovery_codes' },
              { id: makeId('f'), label: 'Private Key', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Wallet Passphrase', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
        ],
      };

    case 'wifi_router':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: 'http://192.168.1.1', label: 'Router Admin', matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Network Name (SSID)', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Wi-Fi Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'Security Protocol', fieldType: 'text', value: 'WPA3 / WPA2', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Admin Password', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Gateway IP', fieldType: 'text', value: '192.168.1.1', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'passport':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Issuing Country', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Full Name', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Passport Number', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Birth Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Issue Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Expiration Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'driver_license':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Full Name', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'License Number', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'License Class', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Issuing Authority', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Expiration Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'membership':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: 'Member Portal', matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Organization / Brand', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Member ID', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Membership Tier', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'PIN / Password', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
              { id: makeId('f'), label: 'Expiration Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'medical_record':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Patient Name', fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: 'Policy / Record ID', fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: 'Blood Type', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Allergies', fieldType: 'multiline', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Emergency Contact', fieldType: 'phone', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'document':
      return {
        ...base,
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: 'Document ID', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Issuer / Organization', fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: 'Access Passcode', fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: 'Archive Date', fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };
  }
}
