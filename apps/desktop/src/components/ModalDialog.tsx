import { useEffect, useRef, type ReactNode } from 'react';
import { attachClosedByFallback, closeTopLayer } from '../utils/topLayer';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  closedBy?: 'any' | 'closerequest' | 'none';
  className?: string;
  children: ReactNode;
}

export function ModalDialog({
  open,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  closedBy = 'any',
  className = '',
  children,
}: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closingViaParentRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.removeAttribute('data-closing');
      dialog.showModal();
    } else if (!open && dialog.open && !closingViaParentRef.current) {
      closingViaParentRef.current = true;
      void closeTopLayer(dialog).finally(() => {
        closingViaParentRef.current = false;
      });
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      if (closedBy === 'none') {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      void closeTopLayer(dialog).then(() => {
        onClose();
      });
    };

    const handleClose = () => {
      dialog.returnValue = '';
      if (open) onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);

    const detachFallback =
      closedBy === 'any'
        ? attachClosedByFallback(dialog, () => {
            void closeTopLayer(dialog).then(() => {
              onClose();
            });
          })
        : () => {};

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      detachFallback();
    };
  }, [closedBy, onClose, open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      {...({ closedby: closedBy } as Record<string, string>)}
      className={`ks-dialog ${className}`}
    >
      {open ? children : null}
    </dialog>
  );
}
