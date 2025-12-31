'use client';

import React, { useState } from 'react';
import * as Toast from '@radix-ui/react-toast';

export type ToastType = 'error' | 'success' | 'info';

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
}

const toastQueue: ToastData[] = [];
let toastListeners: ((toasts: ToastData[]) => void)[] = [];

const notifyListeners = () => {
  toastListeners.forEach(listener => listener([...toastQueue]));
};

export const showToast = (message: string, type: ToastType = 'info') => {
  const id = crypto.randomUUID();
  const toast: ToastData = { id, message, type };

  toastQueue.push(toast);
  notifyListeners();

  // Auto-remove after 5 seconds
  setTimeout(() => {
    removeToast(id);
  }, 5000);
};

export const removeToast = (id: string) => {
  const index = toastQueue.findIndex(t => t.id === id);
  if (index > -1) {
    toastQueue.splice(index, 1);
    notifyListeners();
  }
};

export const useToast = () => {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  React.useEffect(() => {
    const listener = (newToasts: ToastData[]) => {
      setToasts(newToasts);
    };

    toastListeners.push(listener);
    setToasts([...toastQueue]);

    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  return toasts;
};

const ToastComponent: React.FC<{ toast: ToastData }> = ({ toast }) => {
  const [open, setOpen] = useState(true);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      removeToast(toast.id);
    }
  };

  const getStyles = () => {
    if (toast.type === 'error') {
      return 'bg-rose-50 border-rose-200 text-rose-800';
    } else if (toast.type === 'success') {
      return 'bg-emerald-50 border-emerald-200 text-emerald-800';
    } else {
      return 'bg-stone-50 border-stone-200 text-stone-800';
    }
  };

  return (
    <Toast.Root
      className={`
        px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm
        ${getStyles()}
      `}
      open={open}
      onOpenChange={handleOpenChange}
      duration={5000}
    >
      <Toast.Description asChild>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          <Toast.Close asChild>
            <button
              className="text-current opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Toast.Close>
        </div>
      </Toast.Description>
    </Toast.Root>
  );
};

export const ToastContainer: React.FC = () => {
  const toasts = useToast();

  if (toasts.length === 0) return null;

  return (
    <Toast.Provider swipeDirection="right" duration={5000}>
      {toasts.map((toast) => (
        <ToastComponent key={toast.id} toast={toast} />
      ))}
      <Toast.Viewport className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full m-0 p-0 outline-none" />
    </Toast.Provider>
  );
};
