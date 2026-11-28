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
  const getFilter = useUiStore((s) => s.getFilter);
  const showToast = useUiStore((s) => s.showToast);

  const vaults = useVaultStore((s) => s.vaults);
  const createVault = useVaultStore((s) => s.createVault);
  const renameVault = useVaultStore((s) => s.renameVault);
  const setVaultTravelSafe = useVaultStore((s) => s.setVaultTravelSafe);

  const [name, setName] = useState('');
  const [color, setColor] = useState(VAULT_COLORS[0]);
  const [travelSafe, setTravelSafe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingVault = vaultModal?.vaultId
    ? vaults.find((v) => v.id === vaultModal.vaultId)
    : undefined;
  const isDefaultVault = Boolean(vaultModal?.mode === 'rename' && existingVault?.isDefault);

  useEffect(() => {
    if (vaultModal) {
      const currentVaults = useVaultStore.getState().vaults;
      const existing = vaultModal.vaultId
        ? currentVaults.find((v) => v.id === vaultModal.vaultId)
        : undefined;
      setName(vaultModal.initialName ?? existing?.name ?? '');
      setColor(VAULT_COLORS[0]);
      setTravelSafe(Boolean(existing?.travelSafe));
      setError(null);
      setSaving(false);
    }
  }, [vaultModal]);

  const handleClose = () => setVaultModal(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultModal || saving) return;
    const trimmedName = name.trim();
    if (!isDefaultVault && !trimmedName) return;

    setSaving(true);
    setError(null);
    try {
      if (vaultModal.mode === 'create') {
        const created = await createVault(trimmedName, color);
        if (travelSafe) {
          await setVaultTravelSafe(created.id, true, getFilter());
        }
        setActiveVault(created.id);
        showToast({ label: 'Vault', text: fmt(dict.vaultModal.createdToast, { name: created.name }), kind: 'info' });
      } else if (vaultModal.vaultId) {
        const prevName = (existingVault?.name ?? vaultModal.initialName ?? '').trim();
        const prevTravelSafe = Boolean(existingVault?.travelSafe);
        const shouldRename = !isDefaultVault && trimmedName.length > 0 && trimmedName !== prevName;
        const shouldUpdateTravelSafe = travelSafe !== prevTravelSafe;

        if (shouldRename) {
          await renameVault(vaultModal.vaultId, trimmedName);
        }
        if (shouldUpdateTravelSafe) {
          await setVaultTravelSafe(vaultModal.vaultId, travelSafe, getFilter());
        }

        if (shouldRename) {
          showToast({ label: 'Vault', text: fmt(dict.vaultModal.renamedToast, { name: trimmedName }), kind: 'info' });
        } else if (shouldUpdateTravelSafe) {
          showToast({
            label: 'Vault',
            text: fmt(dict.vaultModal.updatedToast, { name: trimmedName || prevName }),
            kind: 'info',
          });
        }
      }
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showToast({ label: 'Vault', text: msg, kind: 'warning' });
    } finally {
      setSaving(false);
    }
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
              {vaultModal.mode === 'create'
                ? dict.vaultModal.createTitle
                : isDefaultVault
                  ? dict.vaultModal.editTitle
                  : dict.vaultModal.renameTitle}
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
              required={!isDefaultVault}
              disabled={isDefaultVault}
              autoFocus={!isDefaultVault}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={dict.vaultModal.namePlaceholder}
              className="ks-input w-full border-[var(--border-strong)] disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {isDefaultVault && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">{dict.vaultModal.defaultNameHint}</p>
            )}
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

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={travelSafe}
              onChange={(e) => setTravelSafe(e.target.checked)}
              className="ks-checkbox"
            />
            <span>{dict.vaultModal.travelSafeLabel}</span>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/30 text-xs text-[var(--status-danger)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={handleClose}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 cursor-pointer"
            >
              {dict.common.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-xs font-medium text-white cursor-pointer"
            >
              {vaultModal.mode === 'create' ? dict.common.create : dict.common.save}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
