import { useEffect } from 'react';
import { tauriClient } from '../services/tauriClient';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';
import { useVaultStore } from '../stores/vaultStore';

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(searchInputRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const vault = useVaultStore.getState();

      if (session.status !== 'Unlocked') return;

      const hasOpenModal =
        Boolean(ui.largeType) || ui.newItemOpen || ui.settingsOpen || ui.quickAccessOpen || Boolean(ui.vaultModal);

      // Quick Access: Cmd+Shift+Space or Cmd+K
      if (mod && ((e.shiftKey && e.code === 'Space') || (!e.shiftKey && key === 'k'))) {
        e.preventDefault();
        ui.setQuickAccessOpen(!ui.quickAccessOpen);
        return;
      }

      if (hasOpenModal) return;

      // Cmd+F: Search
      if (mod && !e.shiftKey && key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Cmd+N: New item
      if (mod && !e.shiftKey && key === 'n') {
        e.preventDefault();
        ui.setNewItemOpen(true);
        return;
      }

      // Cmd+,: Settings
      if (mod && e.key === ',') {
        e.preventDefault();
        ui.setSettingsOpen(true);
        return;
      }

      // Cmd+L: Lock
      if (mod && !e.shiftKey && key === 'l') {
        e.preventDefault();
        void session.lock('shortcut');
        return;
      }

      // Cmd+R: Sync
      if (mod && !e.shiftKey && key === 'r') {
        e.preventDefault();
        void vault.syncNow(ui.getFilter());
        ui.showToast({ label: '同步', text: '正在与 Vaultwarden 同步密文...', kind: 'info' });
        return;
      }

      // Cmd+S: Save in editor
      if (mod && key === 's' && ui.isEditing) {
        e.preventDefault();
        const form = document.getElementById('ks-item-editor-form') as HTMLFormElement | null;
        form?.requestSubmit();
        return;
      }

      // Esc: Cancel editor
      if (e.key === 'Escape' && ui.isEditing) {
        e.preventDefault();
        ui.stopEditing();
        return;
      }

      const item = vault.activeItem;
      if (!item) return;

      // Cmd+E: Toggle Edit
      if (mod && !e.shiftKey && key === 'e' && !item.deletedAt) {
        e.preventDefault();
        if (ui.isEditing) {
          ui.stopEditing();
        } else {
          ui.startEditingExisting();
        }
        return;
      }

      if (isEditableElement(document.activeElement)) return;

      const fields = item.sections.flatMap((s) => s.fields);
      const pwField = fields.find((f) => f.purpose === 'password' && f.value);
      const userField = fields.find((f) => f.purpose === 'username' && f.value);
      const totpField = fields.find((f) => f.fieldType === 'totp' && f.value);

      // Cmd+Shift+L: Large Type
      if (mod && e.shiftKey && key === 'l' && pwField) {
        e.preventDefault();
        ui.openLargeType(pwField.label, pwField.value);
        return;
      }

      // Cmd+Shift+C: Copy Username
      if (mod && e.shiftKey && key === 'c' && userField) {
        e.preventDefault();
        void tauriClient.clipboardCopySecret(userField.value, userField.label, false);
        ui.showToast({ label: userField.label, text: `已复制「${userField.label}」`, kind: 'info' });
        return;
      }

      // Cmd+Alt+C: Copy TOTP
      if (mod && e.altKey && key === 'c' && totpField) {
        e.preventDefault();
        void tauriClient.totpCompute(totpField.value).then(async (res) => {
          await tauriClient.clipboardCopySecret(res.code, '一次性密码', true);
          ui.showToast({
            label: '一次性密码',
            text: `已复制「一次性密码」· ${session.clipboardClearSeconds} 秒后自动清空剪贴板`,
            kind: 'clipboard',
          });
        });
        return;
      }

      // Cmd+C: Copy Password ONLY when no text is selected
      if (mod && !e.shiftKey && !e.altKey && key === 'c' && pwField) {
        const sel = window.getSelection()?.toString();
        if (sel && sel.length > 0) return;
        e.preventDefault();
        void tauriClient.clipboardCopySecret(pwField.value, pwField.label, true);
        ui.showToast({
          label: pwField.label,
          text: `已复制「${pwField.label}」· ${session.clipboardClearSeconds} 秒后自动清空剪贴板`,
          kind: 'clipboard',
        });
        return;
      }

      // Cmd+D: Toggle Favorite
      if (mod && key === 'd') {
        e.preventDefault();
        void vault.toggleFavorite(item.id, !item.favorite, ui.getFilter());
        return;
      }

      // Cmd+Backspace: Move to Trash
      if (mod && e.key === 'Backspace' && !item.deletedAt) {
        e.preventDefault();
        void vault.trashItem(item.id, ui.getFilter());
        ui.showToast({ label: '废纸篓', text: `已将「${item.title}」移入废纸篓`, kind: 'info' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInputRef]);
}
