import { useCallback, useEffect, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "warning" | "error";

export type Toast = {
  id: string;
  key?: string;
  kind: ToastKind;
  title: string;
  message?: string;
  persistent?: boolean;
  durationMs?: number;
};

export type ToastInput = {
  key?: string;
  kind?: ToastKind;
  title: string;
  message?: string;
  persistent?: boolean;
  durationMs?: number;
};

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useToastController() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timeoutId = timers.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timers.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (idOrKey: string) => {
      setToasts((current) => {
        const target = current.find((toast) => toast.id === idOrKey || toast.key === idOrKey);
        if (target) {
          clearTimer(target.id);
        }
        return current.filter((toast) => toast.id !== idOrKey && toast.key !== idOrKey);
      });
    },
    [clearTimer],
  );

  const notify = useCallback(
    (input: ToastInput): string => {
      const durationMs = input.durationMs ?? 3500;
      let toastId = "";

      setToasts((current) => {
        const existing = input.key ? current.find((toast) => toast.key === input.key) : undefined;
        if (existing) {
          toastId = existing.id;
          clearTimer(existing.id);
          return current.map((toast) =>
            toast.id === existing.id
              ? {
                  ...toast,
                  kind: input.kind ?? toast.kind,
                  title: input.title,
                  message: input.message,
                  persistent: input.persistent,
                  durationMs,
                }
              : toast,
          );
        }

        toastId = makeId();
        return [
          ...current,
          {
            id: toastId,
            key: input.key,
            kind: input.kind ?? "info",
            title: input.title,
            message: input.message,
            persistent: input.persistent,
            durationMs,
          },
        ];
      });

      if (!input.persistent) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(toastId);
        }, durationMs);
        timers.current.set(toastId, timeoutId);
      }

      return toastId;
    },
    [clearTimer, dismissToast],
  );

  useEffect(
    () => () => {
      for (const timeoutId of timers.current.values()) {
        window.clearTimeout(timeoutId);
      }
      timers.current.clear();
    },
    [],
  );

  return { toasts, notify, dismissToast };
}

export function ToastViewport(props: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {props.toasts.map((toast) => (
        <article key={toast.id} className={`toast-card ${toast.kind}`}>
          <div className="toast-content">
            <p className="toast-title">{toast.title}</p>
            {toast.message ? <p className="toast-message">{toast.message}</p> : null}
          </div>
          <button className="toast-close" onClick={() => props.onDismiss(toast.id)} aria-label="Dismiss notification">
            ×
          </button>
        </article>
      ))}
    </div>
  );
}
