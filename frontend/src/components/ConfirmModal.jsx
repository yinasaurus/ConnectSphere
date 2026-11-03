import { useEffect, useId } from 'react';
import Button from './Button';

/**
 * Purpose: ask for a yes or no before a change is sent.
 * Inputs: open, title, confirmLabel, cancelLabel, confirmVariant, busy, onConfirm, onCancel.
 * The caller owns the wording and what happens after confirm.
 */
export default function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="card confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="actions">
          <Button variant={confirmVariant} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
