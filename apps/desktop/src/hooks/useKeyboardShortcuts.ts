import { useEffect } from 'react';
import { getDictionary, localizeBuiltinFieldLabel, resolveLocale } from '../i18n';
import { isTauriRuntime, tauriClient } from '../services/tauriClient';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';
import { useVaultStore } from '../stores/vaultStore';
import { matchesShortcut } from '../utils/shortcuts';

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
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();
      const vault = useVaultStore.getState();
      const sc = ui.shortcuts;
      const locale = resolveLocale(ui.languageMode);
      const dict = getDictionary(locale);

      if (session.status !== 'Unlocked' || session.addingAccount) return;

      const hasOpenModal =
        Boolean(ui.largeType) ||
        ui.newItemOpen ||
        ui.settingsOpen ||
        ui.quickAccessOpen ||
        ui.generatorOpen ||
        Boolean(ui.vaultModal);

      if (matchesShortcut(e, sc.quickAccessInApp)) {
        e.preventDefault();
        if (isTauriRuntime()) {
          void tauriClient.windowToggleQuickAccess();
        } else {
          ui.setQuickAccessOpen(!ui.quickAccessOpen);
        }
        return;
      }

      if (matchesShortcut(e, sc.openGenerator)) {
        e.preventDefault();
        if (isTauriRuntime()) {
          void tauriClient.windowToggleGenerator();
        } else {
          ui.setGeneratorOpen(!ui.generatorOpen);
        }
        return;
      }

      if (hasOpenModal) return;

      if (matchesShortcut(e, sc.search)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (matchesShortcut(e, sc.newItem)) {
        e.preventDefault();
        ui.setNewItemOpen(true);
        return;
      }

      if (matchesShortcut(e, sc.openSettings)) {
        e.preventDefault();
        ui.setSettingsOpen(true);
        return;
      }

      if (matchesShortcut(e, sc.lockVault)) {
        e.preventDefault();
        void session.lock('shortcut');
        return;
      }

      if (matchesShortcut(e, sc.syncVault)) {
        e.preventDefault();
        void vault.syncNow(ui.getFilter());
        ui.showToast({ label: dict.sidebar.syncing, text: dict.sidebar.syncing, kind: 'info' });
        return;
      }

      if (matchesShortcut(e, sc.saveItem) && ui.isEditing) {
        e.preventDefault();
        const form = document.getElementById('ks-item-editor-form') as HTMLFormElement | null;
        form?.requestSubmit();
        return;
      }

      if (e.key === 'Escape' && ui.isEditing) {
        if (
          document.querySelector(
            '[popover]:popover-open, [popover].\\:popover-open, [data-ks-dropdown-open="true"]',
          )
        ) {
          return;
        }
        if (document.activeElement instanceof HTMLSelectElement) {
          document.activeElement.blur();
          return;
        }
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('ks:editor-request-cancel'));
        return;
      }

      const item = vault.activeItem;
      if (!item) return;

      const repromptLocked = Boolean(item.reprompt && !ui.repromptVerifiedIds[item.id]);

      if (matchesShortcut(e, sc.editItem) && !item.deletedAt) {
        e.preventDefault();
        if (repromptLocked) {
          ui.showToast({ label: item.title, text: dict.detail.repromptDesc, kind: 'warning' });
          return;
        }
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

      if (matchesShortcut(e, sc.largeType) && pwField) {
        e.preventDefault();
        if (repromptLocked) {
          ui.showToast({ label: item.title, text: dict.detail.repromptDesc, kind: 'warning' });
          return;
        }
        const pwLabel = localizeBuiltinFieldLabel(pwField.label, dict, pwField.purpose);
        ui.openLargeType(pwLabel, pwField.value);
        return;
      }

      if (matchesShortcut(e, sc.copyUsername) && userField) {
        e.preventDefault();
        const userLabel = localizeBuiltinFieldLabel(userField.label, dict, userField.purpose);
        void tauriClient.clipboardCopySecret(userField.value, userLabel, false);
        ui.showToast({
          label: userLabel,
          text: dict.detail.copiedPlainToast.replace('{label}', userLabel),
          kind: 'info',
        });
        return;
      }

      if (matchesShortcut(e, sc.copyTotp) && totpField) {
        e.preventDefault();
        if (repromptLocked) {
          ui.showToast({ label: item.title, text: dict.detail.repromptDesc, kind: 'warning' });
          return;
        }
        void tauriClient.totpCompute(totpField.value).then(async (res) => {
          await tauriClient.clipboardCopySecret(res.code, 'TOTP', true);
          ui.showToast({
            label: 'TOTP',
            text: dict.detail.copiedSensitiveToast
              .replace('{label}', 'TOTP')
              .replace('{secs}', String(session.clipboardClearSeconds)),
            kind: 'clipboard',
          });
        });
        return;
      }

      if (matchesShortcut(e, sc.copyPassword) && pwField) {
        const sel = window.getSelection()?.toString();
        if (sel && sel.length > 0) return;
        e.preventDefault();
        if (repromptLocked) {
          ui.showToast({ label: item.title, text: dict.detail.repromptDesc, kind: 'warning' });
          return;
        }
        const pwLabel = localizeBuiltinFieldLabel(pwField.label, dict, pwField.purpose);
        void tauriClient.clipboardCopySecret(pwField.value, pwLabel, true);
        ui.showToast({
          label: pwLabel,
          text: dict.detail.copiedSensitiveToast
            .replace('{label}', pwLabel)
            .replace('{secs}', String(session.clipboardClearSeconds)),
          kind: 'clipboard',
        });
        return;
      }

      if (matchesShortcut(e, sc.toggleFavorite)) {
        e.preventDefault();
        void vault.toggleFavorite(item.id, !item.favorite, ui.getFilter());
        return;
      }

      if (matchesShortcut(e, sc.moveToTrash) && !item.deletedAt) {
        e.preventDefault();
        void vault.trashItem(item.id, ui.getFilter());
        ui.showToast({ label: dict.sidebar.trash, text: `${dict.detail.moveToTrash}: ${item.title}`, kind: 'info' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchInputRef]);
}
