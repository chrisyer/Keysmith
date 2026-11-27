import { getDictionary, readStoredLanguage, resolveLocale, type Locale } from '../i18n';
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

export function createEmptyDraft(
  category: ItemCategory,
  vaultId: string,
  locale?: Locale,
): ItemDraft {
  const meta = TEMPLATE_MAP[category];
  const dict = getDictionary(locale ?? resolveLocale(readStoredLanguage()));
  const { urls: uLbl, sections: sLbl, fields: fLbl } = dict.templates;
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
        urls: [{ id: makeId('u'), uri: '', label: uLbl.loginPage, matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.username, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.password, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: fLbl.oneTimePassword, fieldType: 'totp', value: '', sensitive: true, copyable: true, purpose: 'totp' },
            ],
          },
        ],
      };

    case 'password':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.website, matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.password, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
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
              { id: makeId('f'), label: fLbl.cardholderName, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.cardNumber, fieldType: 'number', value: '', sensitive: true, copyable: true, purpose: 'card_number' },
              { id: makeId('f'), label: fLbl.expiration, fieldType: 'month_year', value: '', sensitive: false, copyable: true, purpose: 'card_expiry' },
              { id: makeId('f'), label: fLbl.securityCodeCvv, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'card_cvv' },
              { id: makeId('f'), label: fLbl.cardType, fieldType: 'text', value: 'Visa', sensitive: false, copyable: false },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.billingBank,
            fields: [
              { id: makeId('f'), label: fLbl.issuingBank, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.atmPin, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
              { id: makeId('f'), label: fLbl.supportPhone, fieldType: 'phone', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.lastName, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.firstName, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.gender, fieldType: 'text', value: '', sensitive: false, copyable: false },
              { id: makeId('f'), label: fLbl.birthDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.companyTitle, fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.contactInfo,
            fields: [
              { id: makeId('f'), label: fLbl.email, fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.phone, fieldType: 'phone', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.address, fieldType: 'address', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.identification,
            fields: [
              { id: makeId('f'), label: fLbl.nationalIdSsn, fieldType: 'password', value: '', sensitive: true, copyable: true },
            ],
          },
        ],
      };

    case 'api_credential':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.endpointUrl, matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.usernameAppId, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.apiKey, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.apiSecret, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.permissionsExpiry,
            fields: [
              { id: makeId('f'), label: fLbl.scope, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.expirationDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.type, fieldType: 'text', value: 'PostgreSQL', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.host, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.port, fieldType: 'number', value: '5432', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.database, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.username, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.password, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.connection,
            fields: [
              { id: makeId('f'), label: fLbl.connectionUri, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.sslMode, fieldType: 'text', value: 'require', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'server':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.controlPanel, matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.hostIp, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.port, fieldType: 'number', value: '22', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.username, fieldType: 'text', value: 'root', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.password, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: fLbl.rootAdminPassword, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.provider,
            fields: [
              { id: makeId('f'), label: fLbl.consoleAccount, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.regionDatacenter, fieldType: 'text', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.publicKey, fieldType: 'ssh_public_key', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.privateKey, fieldType: 'ssh_private_key', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.passphrase, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: fLbl.fingerprint, fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'software_license':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.downloadPage, matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.licenseKey, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.registeredEmail, fieldType: 'email', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.version, fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
          {
            id: makeId('sec'),
            title: sLbl.purchaseDetails,
            fields: [
              { id: makeId('f'), label: fLbl.purchaseDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.expirationDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.orderNumber, fieldType: 'text', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'passkey':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.website, matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.relyingPartyId, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.relyingPartyName, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.accountUsername, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
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
              { id: makeId('f'), label: fLbl.bankName, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.accountHolder, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.accountNumberIban, fieldType: 'number', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.routingNumber, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.swiftBic, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.phoneBankingPin, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
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
              { id: makeId('f'), label: fLbl.networkAsset, fieldType: 'text', value: 'Ethereum / BTC', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.walletAddress, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.seedPhrase, fieldType: 'multiline', value: '', sensitive: true, copyable: true, purpose: 'recovery_codes' },
              { id: makeId('f'), label: fLbl.privateKey, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.walletPassphrase, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
            ],
          },
        ],
      };

    case 'wifi_router':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: 'http://192.168.1.1', label: uLbl.routerAdmin, matchRule: 'host' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.networkNameSsid, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.wifiPassword, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: fLbl.securityProtocol, fieldType: 'text', value: 'WPA3 / WPA2', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.adminPassword, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.gatewayIp, fieldType: 'text', value: '192.168.1.1', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.issuingCountry, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.fullName, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.passportNumber, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.birthDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.issueDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.expirationDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.fullName, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.licenseNumber, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.licenseClass, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.issuingAuthority, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.expirationDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };

    case 'membership':
      return {
        ...base,
        urls: [{ id: makeId('u'), uri: '', label: uLbl.memberPortal, matchRule: 'domain' }],
        sections: [
          {
            id: makeId('sec'),
            title: '',
            fields: [
              { id: makeId('f'), label: fLbl.organizationBrand, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.memberId, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.membershipTier, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.pinPassword, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'pin' },
              { id: makeId('f'), label: fLbl.expirationDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.patientName, fieldType: 'text', value: '', sensitive: false, copyable: true, purpose: 'username' },
              { id: makeId('f'), label: fLbl.policyRecordId, fieldType: 'password', value: '', sensitive: true, copyable: true },
              { id: makeId('f'), label: fLbl.bloodType, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.allergies, fieldType: 'multiline', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.emergencyContact, fieldType: 'phone', value: '', sensitive: false, copyable: true },
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
              { id: makeId('f'), label: fLbl.documentId, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.issuerOrganization, fieldType: 'text', value: '', sensitive: false, copyable: true },
              { id: makeId('f'), label: fLbl.accessPasscode, fieldType: 'password', value: '', sensitive: true, copyable: true, purpose: 'password' },
              { id: makeId('f'), label: fLbl.archiveDate, fieldType: 'date', value: '', sensitive: false, copyable: true },
            ],
          },
        ],
      };
  }
}
