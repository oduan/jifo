import { useEffect } from 'react';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastItem = {
  id: number;
  message: string;
  action?: ToastAction;
};

const TOAST_DURATION_MS = 5200;

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="jifo-toast" role="status">
      <span className="jifo-toast__message">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="jifo-toast__action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="jifo-toast__close" aria-label="关闭通知" onClick={() => onDismiss(toast.id)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function ToastHost({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="jifo-toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
