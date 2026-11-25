export type ItemCategory =
  | 'login'
  | 'password'
  | 'secure_note'
  | 'credit_card'
  | 'identity'
  | 'api_credential'
  | 'database'
  | 'server'
  | 'ssh_key'
  | 'software_license'
  | 'passkey';

export type FieldType =
  | 'text'
  | 'password'
  | 'email'
  | 'url'
  | 'totp'
  | 'date'
  | 'month_year'
  | 'phone'
  | 'number'
  | 'address'
  | 'multiline'
  | 'ssh_private_key'
  | 'ssh_public_key'
  | 'key_value';

export type FieldPurpose =
  | 'username'
  | 'password'
  | 'totp'
  | 'card_number'
  | 'card_cvv'
  | 'card_expiry'
  | 'pin'
  | 'recovery_codes';

export type UrlMatchRule = 'domain' | 'host' | 'starts_with' | 'exact' | 'never';

export type ItemIcon =
  | { kind: 'domain'; host: string }
  | { kind: 'preset'; name: string; color: string };

export interface ItemField {
  id: string;
  label: string;
  fieldType: FieldType;
  value: string;
  sensitive: boolean;
  copyable: boolean;
  purpose?: FieldPurpose;
}

export interface ItemSection {
  id: string;
  title: string;
  fields: ItemField[];
}

export interface ItemUrl {
  id: string;
  uri: string;
  label?: string;
  matchRule: UrlMatchRule;
}

export interface PasswordHistoryEntry {
  value: string;
  changedAt: string;
}

export interface WatchtowerFlags {
  ignoreWeak: boolean;
  ignoreReused: boolean;
  ignoreMissing2fa: boolean;
  ignoreUnsecuredUrl: boolean;
}

export interface PasskeyCredential {
  credentialId: string; // unpadded Base64URL
  rpId: string;
  rpName: string;
  userHandle: string; // unpadded Base64URL
  userName: string;
  userDisplayName: string;
  algorithm: number; // -7 (ES256 P-256) | -8 (EdDSA)
  privateKeyPkcs8: string;
  publicKeySpki: string;
  signCount: number;
  discoverable: boolean;
  aaguid: string;
  transports: string[];
  backedUp: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AccountPasskey {
  id: string; // unpadded Base64URL credential ID
  passkeyUserId: string; // unpadded Base64URL user ID
  credentialPublicKey: string;
  credentialType: 'public-key';
  credentialDeviceType: 'singleDevice' | 'multiDevice';
  credentialBackedUp: boolean;
  aaguid: string;
  providerIcon?: string;
  name: string;
  transports: string[];
  lastUsedAt?: number;
  registeredAt: number;
  counter: number;
  prfSupported: boolean;
}

export interface PasskeyAssertionReceipt {
  credentialId: string;
  rpId: string;
  userName: string;
  clientDataHash: string;
  authenticatorData: string;
  signature: string;
  signCount: number;
  verifiedAt: string;
}

export interface ItemPayload {
  schema: 'keysmith.item.v1';
  category: ItemCategory;
  subtitle?: string;
  icon?: ItemIcon;
  tags: string[];
  urls: ItemUrl[];
  sections: ItemSection[];
  passkeys: PasskeyCredential[];
  notes: string;
  passwordHistory: PasswordHistoryEntry[];
  watchtower: WatchtowerFlags;
  createdAt: string;
  updatedAt: string;
}

export interface Vault {
  id: string;
  name: string;
  icon: string;
  color: string;
  isDefault: boolean;
  itemCount: number;
}

export type WatchtowerIssueType =
  | 'weak'
  | 'reused'
  | 'missing_2fa'
  | 'unsecured_url'
  | 'expiring'
  | 'breached';

export interface ItemSummary {
  id: string;
  vaultId: string;
  title: string;
  subtitle: string;
  category: ItemCategory;
  icon?: ItemIcon;
  tags: string[];
  favorite: boolean;
  hasTotp: boolean;
  hasPasskey: boolean;
  primaryUrl?: string;
  username?: string;
  hasPassword: boolean;
  deletedAt?: string;
  updatedAt: string;
  issues: WatchtowerIssueType[];
}

export interface ItemDetail extends ItemPayload {
  id: string;
  vaultId: string;
  title: string;
  favorite: boolean;
  deletedAt?: string;
}

export interface ItemDraft {
  id?: string;
  vaultId: string;
  title: string;
  favorite: boolean;
  category: ItemCategory;
  subtitle?: string;
  icon?: ItemIcon;
  tags: string[];
  urls: ItemUrl[];
  sections: ItemSection[];
  passkeys: PasskeyCredential[];
  notes: string;
  passwordHistory: PasswordHistoryEntry[];
  watchtower: WatchtowerFlags;
}

export type SortBy = 'title_asc' | 'title_desc' | 'updated_desc' | 'created_desc';

export interface ItemFilter {
  vaultId?: string | null;
  category?: ItemCategory | null;
  tag?: string | null;
  favorite?: boolean;
  passkeyOnly?: boolean;
  trashed?: boolean;
  watchtowerIssue?: WatchtowerIssueType | null;
  query?: string;
  sortBy?: SortBy;
}

export type AuthStatus = 'Unauthenticated' | 'Locked' | 'Unlocked';

export interface SessionState {
  status: AuthStatus;
  email: string;
  displayName: string;
  serverUrl: string;
  biometricEnabled: boolean;
  autoLockMinutes: number;
  clipboardClearSeconds: number;
  lastSyncAt: string;
  kdfType: 'Argon2id' | 'PBKDF2';
}

export type SyncStateKind = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncStateKind;
  pendingCount: number;
  lastSyncAt: string;
  message?: string;
  signalrConnected: boolean;
}

export type GeneratorMode = 'password' | 'passphrase' | 'pin';

export interface GeneratorOptions {
  mode: GeneratorMode;
  length: number;
  includeDigits: boolean;
  includeSymbols: boolean;
  excludeAmbiguous: boolean;
  wordCount: number;
  separator: '-' | '.' | '_' | ' ';
  capitalize: boolean;
  includeNumberInPhrase: boolean;
  pinLength: number;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropyBits: number;
}

export interface GeneratorResult {
  value: string;
  strength: PasswordStrength;
}

export interface TotpCode {
  code: string;
  formattedCode: string;
  remainingSeconds: number;
  period: number;
}

export interface WatchtowerReport {
  score: number;
  totalAudited: number;
  totalRiskItems: number;
  counts: Record<WatchtowerIssueType, number>;
  itemIdsByIssue: Record<WatchtowerIssueType, string[]>;
  itemIssues: Record<string, WatchtowerIssueType[]>;
  hibpChecked: boolean;
  hibpCheckedAt?: string;
}

export interface KdfConfig {
  kdf: 0 | 1;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
}
