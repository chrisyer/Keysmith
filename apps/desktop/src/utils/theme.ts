export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

export function readStoredThemeMode(): ThemeMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

export function applyThemeMode(mode: ThemeMode): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const content = mode === 'system' ? 'light dark' : mode;
  if (meta) {
    meta.content = content;
  }
  try {
    if (mode === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // ignore storage errors
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function subscribeThemeChanges(
  onSystemChange: (prefersDark: boolean) => void,
  onStorageChange: (mode: ThemeMode) => void,
): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMq = (e: MediaQueryListEvent) => {
    onSystemChange(e.matches);
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      const mode = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system';
      const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
      if (meta) {
        meta.content = mode === 'system' ? 'light dark' : mode;
      }
      onStorageChange(mode);
    }
  };
  mq.addEventListener('change', handleMq);
  window.addEventListener('storage', handleStorage);
  return () => {
    mq.removeEventListener('change', handleMq);
    window.removeEventListener('storage', handleStorage);
  };
}
