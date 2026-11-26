import { isTauriRuntime, tauriClient } from '../services/tauriClient';

/**
 * Validates that a URL uses http/https and opens it in the system browser
 * (via Tauri opener in native mode or a safe window.open in browser preview).
 */
export async function openExternalUrl(rawUrl: string): Promise<void> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return;
  }

  const safeUrl = parsed.toString();
  if (isTauriRuntime()) {
    await tauriClient.systemOpenUrl(safeUrl);
  } else {
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
  }
}
