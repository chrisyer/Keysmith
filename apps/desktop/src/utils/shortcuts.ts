export type ShortcutActionId =
  | 'quickAccessInApp'
  | 'search'
  | 'newItem'
  | 'openGenerator'
  | 'editItem'
  | 'saveItem'
  | 'copyPassword'
  | 'copyUsername'
  | 'copyTotp'
  | 'largeType'
  | 'toggleFavorite'
  | 'moveToTrash'
  | 'lockVault'
  | 'syncVault'
  | 'openSettings';

export type ShortcutMap = Record<ShortcutActionId, string>;

export const DEFAULT_GLOBAL_QUICK_ACCESS_SHORTCUT = 'CommandOrControl+Shift+Space';

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  quickAccessInApp: 'CommandOrControl+K',
  search: 'CommandOrControl+F',
  newItem: 'CommandOrControl+N',
  openGenerator: 'CommandOrControl+Shift+G',
  editItem: 'CommandOrControl+E',
  saveItem: 'CommandOrControl+S',
  copyPassword: 'CommandOrControl+C',
  copyUsername: 'CommandOrControl+Shift+C',
  copyTotp: 'CommandOrControl+Alt+C',
  largeType: 'CommandOrControl+Shift+L',
  toggleFavorite: 'CommandOrControl+D',
  moveToTrash: 'CommandOrControl+Backspace',
  lockVault: 'CommandOrControl+L',
  syncVault: 'CommandOrControl+R',
  openSettings: 'CommandOrControl+,',
};

export const SHORTCUT_ACTION_ORDER: ShortcutActionId[] = [
  'quickAccessInApp',
  'search',
  'newItem',
  'openGenerator',
  'editItem',
  'saveItem',
  'copyPassword',
  'copyUsername',
  'copyTotp',
  'largeType',
  'toggleFavorite',
  'moveToTrash',
  'lockVault',
  'syncVault',
  'openSettings',
];

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

function codeToNormalizedKey(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const code = e.code;
  if (code && code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toUpperCase();
  }
  if (code && code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }
  if (code && /^F([1-9]|1[0-2])$/.test(code)) {
    return code;
  }
  if (code && CODE_TO_KEY[code]) {
    return CODE_TO_KEY[code];
  }
  if (e.key === ' ') return 'Space';
  if (e.key.length === 1) return e.key.toUpperCase();
  if (['Backspace', 'Delete', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    return e.key;
  }
  return null;
}

export function keyboardEventToCombo(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) {
    return null;
  }
  const hasMod = e.metaKey || e.ctrlKey;
  const hasAlt = e.altKey;
  const hasShift = e.shiftKey;
  // Require at least Command/Ctrl or Alt so typing plain text isn't hijacked
  if (!hasMod && !hasAlt) {
    return null;
  }
  const mainKey = codeToNormalizedKey(e);
  if (!mainKey) return null;

  const parts: string[] = [];
  if (hasMod) parts.push('CommandOrControl');
  if (hasAlt) parts.push('Alt');
  if (hasShift) parts.push('Shift');
  parts.push(mainKey);
  return parts.join('+');
}

export function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  let expectMod = false;
  let expectAlt = false;
  let expectShift = false;
  let expectKey = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'commandorcontrol' || lower === 'cmdorctrl' || lower === 'command' || lower === 'ctrl' || lower === 'control') {
      expectMod = true;
    } else if (lower === 'alt' || lower === 'option') {
      expectAlt = true;
    } else if (lower === 'shift') {
      expectShift = true;
    } else {
      expectKey = part.length === 1 ? part.toUpperCase() : part;
    }
  }

  const actualMod = e.metaKey || e.ctrlKey;
  if (actualMod !== expectMod || e.altKey !== expectAlt || e.shiftKey !== expectShift) {
    return false;
  }

  const actualKey = codeToNormalizedKey(e);
  if (!actualKey) return false;
  return actualKey.toLowerCase() === expectKey.toLowerCase();
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const plat = navigator.platform || navigator.userAgent || '';
  return /Mac/i.test(plat) && !/iPhone|iPad|iPod/i.test(plat);
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const plat = navigator.platform || navigator.userAgent || '';
  return /Win/i.test(plat);
}

export function isLinuxPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const plat = navigator.platform || navigator.userAgent || '';
  return !/Win/i.test(plat) && /Linux/i.test(plat);
}

export function formatShortcut(combo: string, platform?: 'mac' | 'other'): string {
  if (!combo) return '';
  const useMac = platform ? platform === 'mac' : isMacPlatform();
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);

  if (useMac) {
    return parts
      .map((p) => {
        const lower = p.toLowerCase();
        if (lower === 'commandorcontrol' || lower === 'cmdorctrl' || lower === 'command' || lower === 'cmd') return '⌘';
        if (lower === 'ctrl' || lower === 'control') return '⌃';
        if (lower === 'alt' || lower === 'option') return '⌥';
        if (lower === 'shift') return '⇧';
        if (lower === 'backspace') return '⌫';
        if (lower === 'delete') return '⌦';
        if (lower === 'enter' || lower === 'return') return '⏎';
        if (lower === 'escape' || lower === 'esc') return 'Esc';
        if (lower === 'comma') return ',';
        if (lower === 'space') return 'Space';
        if (lower === 'arrowup') return '↑';
        if (lower === 'arrowdown') return '↓';
        if (lower === 'arrowleft') return '←';
        if (lower === 'arrowright') return '→';
        return p.length === 1 ? p.toUpperCase() : p;
      })
      .join('');
  }

  return parts
    .map((p) => {
      const lower = p.toLowerCase();
      if (
        lower === 'commandorcontrol' ||
        lower === 'cmdorctrl' ||
        lower === 'command' ||
        lower === 'cmd' ||
        lower === 'meta' ||
        lower === 'super' ||
        lower === 'ctrl' ||
        lower === 'control'
      ) {
        return 'Ctrl';
      }
      if (lower === 'alt' || lower === 'option') return 'Alt';
      if (lower === 'shift') return 'Shift';
      if (lower === 'backspace') return 'Backspace';
      if (lower === 'delete') return 'Del';
      if (lower === 'enter' || lower === 'return') return 'Enter';
      if (lower === 'escape' || lower === 'esc') return 'Esc';
      if (lower === 'comma') return ',';
      if (lower === 'space') return 'Space';
      if (lower === 'arrowup') return '↑';
      if (lower === 'arrowdown') return '↓';
      if (lower === 'arrowleft') return '←';
      if (lower === 'arrowright') return '→';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join('+');
}

export function formatShortcutMac(combo: string): string {
  return formatShortcut(combo);
}

export function mergeCustomShortcuts(custom?: Record<string, string> | null): ShortcutMap {
  const merged: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  if (!custom) return merged;
  for (const key of SHORTCUT_ACTION_ORDER) {
    const val = custom[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      merged[key] = val.trim();
    }
  }
  return merged;
}
