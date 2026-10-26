import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome/Android fire this once, early; keep it for whenever the golfer taps "Add to home screen".
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** How this phone can add the app to its home screen. */
export function useInstallPrompt():
  | { kind: 'installed' }
  | { kind: 'prompt'; prompt: () => Promise<void> }
  | { kind: 'ios' }
  | { kind: 'manual' } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (standalone()) return { kind: 'installed' };
  if (deferred) {
    const ev = deferred;
    return {
      kind: 'prompt',
      prompt: async () => {
        await ev.prompt();
        await ev.userChoice.catch(() => null);
        deferred = null;
        listeners.forEach((l) => l());
      },
    };
  }
  return isIos() ? { kind: 'ios' } : { kind: 'manual' };
}
