"use client";

import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Info,
  X,
  XCircle,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

const DEFAULT_TOAST_DURATION = 4200;
const EXIT_ANIMATION_MS = 180;

const TOAST_META = {
  success: {
    icon: CheckCircle2,
    accentClass: "is-success",
  },
  error: {
    icon: XCircle,
    accentClass: "is-error",
  },
  warning: {
    icon: AlertTriangle,
    accentClass: "is-warning",
  },
  info: {
    icon: Info,
    accentClass: "is-info",
  },
  confirmation: {
    icon: HelpCircle,
    accentClass: "is-confirmation",
  },
};

function getToastMeta(type) {
  return TOAST_META[type] || TOAST_META.info;
}

function subscribeToClientReady() {
  return () => {};
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const autoDismissTimers = useRef(new Map());
  const removeTimers = useRef(new Map());
  const isClient = useSyncExternalStore(
    subscribeToClientReady,
    () => true,
    () => false
  );

  useEffect(() => {
    const autoTimers = autoDismissTimers.current;
    const exitTimers = removeTimers.current;
    return () => {
      autoTimers.forEach((timer) => window.clearTimeout(timer));
      exitTimers.forEach((timer) => window.clearTimeout(timer));
      autoTimers.clear();
      exitTimers.clear();
    };
  }, []);

  const removeToast = useCallback((toastId) => {
    const removeTimer = removeTimers.current.get(toastId);
    if (removeTimer) {
      window.clearTimeout(removeTimer);
      removeTimers.current.delete(toastId);
    }
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const dismissToast = useCallback(
    (toastId) => {
      const autoTimer = autoDismissTimers.current.get(toastId);
      if (autoTimer) {
        window.clearTimeout(autoTimer);
        autoDismissTimers.current.delete(toastId);
      }

      setToasts((current) =>
        current.map((toast) =>
          toast.id === toastId ? { ...toast, isClosing: true } : toast
        )
      );

      if (!removeTimers.current.has(toastId)) {
        const timer = window.setTimeout(() => {
          removeToast(toastId);
        }, EXIT_ANIMATION_MS);
        removeTimers.current.set(toastId, timer);
      }
    },
    [removeToast]
  );

  const showToast = useCallback(
    ({
      type = "info",
      title = "",
      message = "",
      duration = DEFAULT_TOAST_DURATION,
      action = null,
    }) => {
      const toastId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      setToasts((current) => [
        ...current,
        {
          id: toastId,
          type,
          title,
          message,
          action,
          isClosing: false,
        },
      ]);

      if (Number.isFinite(duration) && duration > 0) {
        const timer = window.setTimeout(() => {
          dismissToast(toastId);
        }, duration);
        autoDismissTimers.current.set(toastId, timer);
      }

      return toastId;
    },
    [dismissToast]
  );

  const closeConfirm = useCallback(() => {
    setConfirmState((current) => {
      if (current?.isProcessing) return current;
      return null;
    });
  }, []);

  const openConfirm = useCallback((options) => {
    setConfirmState({
      title: options?.title || "Confirm action",
      message: options?.message || "",
      details: options?.details || "",
      tone: options?.tone || "info",
      confirmLabel: options?.confirmLabel || "Confirm",
      cancelLabel: options?.cancelLabel || "Cancel",
      pendingLabel: options?.pendingLabel || "Working...",
      onConfirm: options?.onConfirm || null,
      isProcessing: false,
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    if (!confirmState.onConfirm) {
      setConfirmState(null);
      return;
    }

    setConfirmState((current) =>
      current ? { ...current, isProcessing: true } : current
    );

    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch {
      setConfirmState((current) =>
        current ? { ...current, isProcessing: false } : current
      );
    }
  }, [confirmState]);

  const toastValue = useMemo(
    () => ({
      showToast,
      dismissToast,
    }),
    [dismissToast, showToast]
  );

  const confirmValue = useMemo(
    () => ({
      openConfirm,
      closeConfirm,
    }),
    [closeConfirm, openConfirm]
  );

  const portalTarget =
    isClient && typeof document !== "undefined" ? document.body : null;

  return (
    <ToastContext.Provider value={toastValue}>
      <ConfirmContext.Provider value={confirmValue}>
        {children}
        {portalTarget
          ? createPortal(
              <>
                <div className="cfb-toast-viewport" aria-live="polite" aria-atomic="true">
                  {toasts.map((toast) => {
                    const meta = getToastMeta(toast.type);
                    const Icon = meta.icon;
                    return (
                      <div
                        key={toast.id}
                        className={`cfb-toast ${meta.accentClass}${
                          toast.isClosing ? " is-closing" : ""
                        }`}
                        role="status"
                      >
                        <span className="cfb-toast-icon">
                          <Icon size={18} />
                        </span>
                        <div className="cfb-toast-copy">
                          {toast.title ? <strong>{toast.title}</strong> : null}
                          {toast.message ? <p>{toast.message}</p> : null}
                          {toast.action?.label ? (
                            <button
                              type="button"
                              className="cfb-toast-action"
                              onClick={() => {
                                toast.action?.onClick?.();
                                if (toast.action?.keepOpen) return;
                                dismissToast(toast.id);
                              }}
                            >
                              {toast.action.label}
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="cfb-toast-close"
                          onClick={() => dismissToast(toast.id)}
                          aria-label="Dismiss notification"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {confirmState ? (
                  <div className="cfb-confirm-backdrop" onClick={closeConfirm}>
                    <div
                      className="cfb-confirm-modal"
                      onClick={(event) => event.stopPropagation()}
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="cfb-confirm-title"
                    >
                      <div className="cfb-confirm-head">
                        <div className={`cfb-confirm-icon is-${confirmState.tone}`}>
                          {confirmState.tone === "danger" ? (
                            <AlertTriangle size={18} />
                          ) : confirmState.tone === "warning" ? (
                            <AlertTriangle size={18} />
                          ) : (
                            <HelpCircle size={18} />
                          )}
                        </div>
                        <button
                          type="button"
                          className="ws-modal-close"
                          onClick={closeConfirm}
                          aria-label="Close confirmation dialog"
                          disabled={confirmState.isProcessing}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="cfb-confirm-copy">
                        <p className="ws-kicker">Confirmation</p>
                        <h2 id="cfb-confirm-title">{confirmState.title}</h2>
                        {confirmState.message ? (
                          <p className="ws-subtitle">{confirmState.message}</p>
                        ) : null}
                        {confirmState.details ? (
                          <div className="cfb-confirm-details" title={confirmState.details}>
                            {confirmState.details}
                          </div>
                        ) : null}
                      </div>

                      <div className="cfb-confirm-actions">
                        <button
                          type="button"
                          className="ws-btn ws-btn-ghost cfb-confirm-btn"
                          onClick={closeConfirm}
                          disabled={confirmState.isProcessing}
                        >
                          {confirmState.cancelLabel}
                        </button>
                        <button
                          type="button"
                          className={`ws-btn cfb-confirm-btn cfb-confirm-primary is-${confirmState.tone}`}
                          onClick={handleConfirm}
                          disabled={confirmState.isProcessing}
                        >
                          {confirmState.isProcessing
                            ? confirmState.pendingLabel
                            : confirmState.confirmLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>,
              portalTarget
            )
          : null}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within FeedbackProvider.");
  }
  return context;
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within FeedbackProvider.");
  }
  return context;
}
