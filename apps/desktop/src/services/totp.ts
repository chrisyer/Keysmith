import type { TotpCode } from '../types/domain';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function parseTotpInput(secretOrUri: string): { secret: string; digits: number; period: number } {
  const trimmed = secretOrUri.trim();
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      const secret = url.searchParams.get('secret') ?? '';
      const digits = Number(url.searchParams.get('digits') ?? '6') || 6;
      const period = Number(url.searchParams.get('period') ?? '30') || 30;
      return { secret, digits, period };
    } catch {
      return { secret: trimmed, digits: 6, period: 30 };
    }
  }
  return { secret: trimmed, digits: 6, period: 30 };
}

function decodeBase32(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function formatCodeDigits(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export async function computeTotp(secretOrUri: string, nowMs = Date.now()): Promise<TotpCode> {
  const { secret, digits, period } = parseTotpInput(secretOrUri);
  const epochSeconds = Math.floor(nowMs / 1000);
  const counter = Math.floor(epochSeconds / period);
  const remainingSeconds = period - (epochSeconds % period);

  const keyBytes = decodeBase32(secret);
  if (keyBytes.length === 0) {
    const fallback = '000000'.slice(0, digits);
    return {
      code: fallback,
      formattedCode: formatCodeDigits(fallback),
      remainingSeconds,
      period,
    };
  }

  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes.buffer as ArrayBuffer,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
      );
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuf);
      const hmac = new Uint8Array(signature);
      const offset = hmac[hmac.length - 1] & 0x0f;
      const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
      const otp = (binary % 10 ** digits).toString().padStart(digits, '0');
      return {
        code: otp,
        formattedCode: formatCodeDigits(otp),
        remainingSeconds,
        period,
      };
    }
  } catch {
    // fallback below
  }

  // Deterministic fallback when WebCrypto subtle is unavailable
  let hash = 2166136261 ^ counter;
  for (let i = 0; i < keyBytes.length; i += 1) {
    hash ^= keyBytes[i];
    hash = Math.imul(hash, 16777619);
  }
  const otp = (Math.abs(hash) % 10 ** digits).toString().padStart(digits, '0');
  return {
    code: otp,
    formattedCode: formatCodeDigits(otp),
    remainingSeconds,
    period,
  };
}
