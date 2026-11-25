import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModalDialog } from '../../components/ModalDialog';
import { useUiStore } from '../../stores/uiStore';
import { useVaultStore } from '../../stores/vaultStore';

const VAULT_COLORS = ['#0572EC', '#0D9488', '#7C3AED', '#D97706', '#DB2777', '#16A34A'];

export function VaultModal() {
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
      showToast({ label: 'Vault', text: `已创建保险库「${created.name}」`, kind: 'info' });
    } else if (vaultModal.vaultId) {
      await renameVault(vaultModal.vaultId, name);
      showToast({ label: 'Vault', text: `已重命名为「${name.trim()}」`, kind: 'info' });
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
              {vaultModal.mode === 'create' ? '新建保险库 (Vault)' : '重命名保险库'}
            </h1>
            <button
              type="button"
              onClick={handleClose}
              aria-label="关闭"
              className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          <div>
            <label htmlFor="vault-name-input" className="block text-xs text-[var(--text-secondary)] mb-1.5">
              保险库名称
            </label>
            <input
              id="vault-name-input"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：家庭共享 / 客户项目"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-strong)] focus:border-[var(--accent-primary)] focus:outline-none text-xs text-[var(--text-primary)]"
            />
          </div>

          {vaultModal.mode === 'create' && (
            <div>
              <span className="block text-xs text-[var(--text-secondary)] mb-1.5">标识色</span>
              <div className="flex items-center gap-2">
                {VAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`选择颜色 ${c}`}
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
              取消
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-xs font-medium text-white cursor-pointer"
            >
              {vaultModal.mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
