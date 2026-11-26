import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { useI18n } from '../../i18n';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

const VAULT_COLORS = ['#0572EC', '#0D9488', '#7C3AED', '#D97706', '#DB2777', '#16A34A'];

export function VaultModal() {
  const { dict, fmt } = useI18n();
  const vaultModal = useUiStore((s) => s.vaultModal);
  const setVaultModal = useUiStore((s) => s.setVaultModal);
  const setActiveVault = useUiStore((s) => s.setActiveVault);
  const showToast = useUiStore((s) => s.showToast);

  const createVault = useVaultStore((s) => s.createVault);
  const renameVault = useVaultStore((s) => s.renameVault);

  const [name, setName] = useState('');
  const [color, setColor] = useState(VAULT_COLORS[0]);

  useEffect(() => {
    if (vaultModal) {
      setName(vaultModal.initialName ?? '');
      setColor(VAULT_COLORS[0]);
    }
  }, [vaultModal]);

  const handleClose = () => setVaultModal(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultModal || !name.trim()) return;
    if (vaultModal.mode === 'create') {
      const created = await createVault(name, color);
      setActiveVault(created.id);
      showToast({ label: 'Vault', text: fmt(dict.vaultModal.createdToast, { name: created.name }), kind: 'info' });
    } else if (vaultModal.vaultId) {
      await renameVault(vaultModal.vaultId, name);
      showToast({ label: 'Vault', text: fmt(dict.vaultModal.renamedToast, { name: name.trim() }), kind: 'info' });
    }
    handleClose();
  };

  return (
    <ModalDialog
      open={Boolean(vaultModal)}
      onClose={handleClose}
      ariaLabelledBy="vault-modal-title"
      closedBy="any"
      className="rounded-2xl w-[min(380px,90vw)] shadow-2xl"
    >
      {vaultModal && (
        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 id="vault-modal-title" className="text-sm font-semibold text-[var(--text-primary)]">
              {vaultModal.mode === 'create' ? dict.vaultModal.createTitle : dict.vaultModal.renameTitle}
            </h1>
            <button
              type="button"
              onClick={handleClose}
              aria-label={dict.common.close}
              className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          <div>
            <label htmlFor="vault-name-input" className="block text-xs text-[var(--text-secondary)] mb-1.5">
              {dict.vaultModal.nameLabel}
            </label>
            <input
              id="vault-name-input"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={dict.vaultModal.namePlaceholder}
              className="ks-input w-full border-[var(--border-strong)]"
            />
          </div>

          {vaultModal.mode === 'create' && (
            <div>
              <span className="block text-xs text-[var(--text-secondary)] mb-1.5">{dict.vaultModal.colorLabel}</span>
              <div className="flex items-center gap-2">
                {VAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={c}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                      color === c ? 'scale-115 ring-2 ring-offset-2 ring-[var(--accent-primary)]' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {dict.common.cancel}
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              {vaultModal.mode === 'create' ? dict.common.create : dict.common.save}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
