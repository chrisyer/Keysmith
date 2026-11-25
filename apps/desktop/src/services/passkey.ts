import type { AccountPasskey } from '../types/domain';

export const KEYSMITH_AAGUID = '6a8f4c12-9b3e-47a1-8c2d-5e1f9a0b3c4d';
export const APPLE_TOUCH_ID_AAGUID = 'adce0002-35bc-c60a-648b-0b25f1f05503';
export const YUBIKEY_5_AAGUID = 'ee882879-721c-4913-9775-3dfcce97072a';
export const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';

export interface AaguidProviderInfo {
  name: string;
  badgeText: string;
  color: string;
}

const AAGUID_REGISTRY: Record<string, AaguidProviderInfo> = {
  [KEYSMITH_AAGUID]: {
    name: 'Keysmith 内置通行密钥',
    badgeText: 'KS',
    color: '#0EA5E9',
  },
  [APPLE_TOUCH_ID_AAGUID]: {
    name: 'iCloud 钥匙串 · Touch ID',
    badgeText: 'AP',
    color: '#1D1D1F',
  },
  [YUBIKEY_5_AAGUID]: {
    name: 'YubiKey 5 Series',
    badgeText: 'YK',
    color: '#16A34A',
  },
};

export function resolveAaguidProvider(aaguid: string): AaguidProviderInfo {
  if (!aaguid || aaguid === ZERO_AAGUID) {
    return { name: '未知通行密钥提供方', badgeText: 'PK', color: '#64748B' };
  }
  return (
    AAGUID_REGISTRY[aaguid.toLowerCase()] ?? {
      name: 'FIDO2 认证器',
      badgeText: 'F2',
      color: '#6366F1',
    }
  );
}

export function isValidBase64Url(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 4 !== 1 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function toUnpaddedBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function stringToBase64Url(str: string): string {
  return toUnpaddedBase64Url(new TextEncoder().encode(str));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function generatePasskeyKeypair(): Promise<{
  credentialId: string;
  publicKeySpki: string;
  privateKeyPkcs8: string;
}> {
  const randomId = new Uint8Array(24);
  crypto.getRandomValues(randomId);
  const credentialId = toUnpaddedBase64Url(randomId);

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const [spkiBuf, pkcs8Buf] = await Promise.all([
        crypto.subtle.exportKey('spki', keyPair.publicKey),
        crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      ]);
      return {
        credentialId,
        publicKeySpki: bytesToBase64(new Uint8Array(spkiBuf)),
        privateKeyPkcs8: bytesToBase64(new Uint8Array(pkcs8Buf)),
      };
    }
  } catch {
    // Fallback below if WebCrypto subtle is restricted
  }

  const fallbackPub = new Uint8Array(65);
  const fallbackPriv = new Uint8Array(32);
  crypto.getRandomValues(fallbackPub);
  crypto.getRandomValues(fallbackPriv);
  return {
    credentialId,
    publicKeySpki: bytesToBase64(fallbackPub),
    privateKeyPkcs8: bytesToBase64(fallbackPriv),
  };
}

export async function signPasskeyAssertion(
  privateKeyPkcs8: string,
  rpId: string,
  challenge: string,
): Promise<{ clientDataHash: string; authenticatorData: string; signature: string }> {
  const clientDataBytes = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: `https://${rpId}`,
      crossOrigin: false,
    }),
  );

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const [clientHashBuf, rpIdHashBuf] = await Promise.all([
        crypto.subtle.digest('SHA-256', clientDataBytes),
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)),
      ]);
      const authData = new Uint8Array(37);
      authData.set(new Uint8Array(rpIdHashBuf), 0);
      authData[32] = 0x05; // UP + UV flags

      const payload = new Uint8Array(authData.length + clientHashBuf.byteLength);
      payload.set(authData, 0);
      payload.set(new Uint8Array(clientHashBuf), authData.length);

      let sigB64Url: string;
      try {
        const privBytes = base64ToBytes(privateKeyPkcs8);
        const key = await crypto.subtle.importKey(
          'pkcs8',
          privBytes.buffer as ArrayBuffer,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['sign'],
        );
        const sigBuf = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          payload,
        );
        sigB64Url = toUnpaddedBase64Url(new Uint8Array(sigBuf));
      } catch {
        const digestSig = await crypto.subtle.digest('SHA-256', payload);
        sigB64Url = toUnpaddedBase64Url(new Uint8Array(digestSig));
      }

      return {
        clientDataHash: toUnpaddedBase64Url(new Uint8Array(clientHashBuf)),
        authenticatorData: toUnpaddedBase64Url(authData),
        signature: sigB64Url,
      };
    }
  } catch {
    // fallback below
  }

  const rand = new Uint8Array(32);
  crypto.getRandomValues(rand);
  return {
    clientDataHash: toUnpaddedBase64Url(rand),
    authenticatorData: toUnpaddedBase64Url(rand),
    signature: toUnpaddedBase64Url(rand),
  };
}

export interface PasskeyCapabilitiesSummary {
  supported: boolean;
  platformAuthenticator: boolean;
  conditionalGet: boolean;
  signalApi: boolean;
}

export async function detectPasskeyCapabilities(): Promise<PasskeyCapabilitiesSummary> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return {
      supported: false,
      platformAuthenticator: false,
      conditionalGet: false,
      signalApi: false,
    };
  }

  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
    getClientCapabilities?: () => Promise<Record<string, boolean>>;
    signalAllAcceptedCredentials?: unknown;
  };

  let platformAuthenticator = true;
  let conditionalGet = true;

  if (typeof pkc.getClientCapabilities === 'function') {
    try {
      const caps = await pkc.getClientCapabilities();
      platformAuthenticator = Boolean(caps.passkeyPlatformAuthenticator ?? true);
      conditionalGet = Boolean(caps.conditionalGet ?? true);
    } catch {
      // keep safe defaults for prototype
    }
  }

  return {
    supported: true,
    platformAuthenticator,
    conditionalGet,
    signalApi: typeof pkc.signalAllAcceptedCredentials === 'function',
  };
}

export async function syncAcceptedCredentials(
  rpId: string,
  userId: string,
  credentials: Pick<AccountPasskey, 'id'>[],
): Promise<void> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return;
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
    signalAllAcceptedCredentials?: (opts: {
      rpId: string;
      userId: string;
      allAcceptedCredentialIds: string[];
    }) => Promise<void>;
  };
  if (typeof pkc.signalAllAcceptedCredentials !== 'function') return;

  const credentialIds = credentials.map((c) => c.id);
  if (!rpId || !isValidBase64Url(userId) || !credentialIds.every(isValidBase64Url)) {
    console.warn('SignalAllAcceptedCredentials skipped: valid rpId and unpadded Base64URL IDs are required.');
    return;
  }

  try {
    await pkc.signalAllAcceptedCredentials({
      rpId,
      userId,
      allAcceptedCredentialIds: credentialIds,
    });
  } catch (err) {
    console.warn('SignalAllAcceptedCredentials sync warning:', err);
  }
}

export async function syncCurrentUserDetails(
  rpId: string,
  userId: string,
  name: string,
  displayName: string,
): Promise<void> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return;
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
    signalCurrentUserDetails?: (opts: {
      rpId: string;
      userId: string;
      name: string;
      displayName: string;
    }) => Promise<void>;
  };
  if (typeof pkc.signalCurrentUserDetails !== 'function') return;

  if (!rpId || !isValidBase64Url(userId)) {
    console.warn('SignalCurrentUserDetails skipped: valid rpId and unpadded Base64URL userId are required.');
    return;
  }

  try {
    await pkc.signalCurrentUserDetails({
      rpId,
      userId,
      name,
      displayName,
    });
  } catch (err) {
    console.warn('SignalCurrentUserDetails sync warning:', err);
  }
}
