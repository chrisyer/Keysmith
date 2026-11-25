import { useEffect, useRef } from 'react';
import { tauriClient } from '../services/tauriClient';
import { useSessionStore } from '../stores/sessionStore';

export function useActivityTracker() {
  const status = useSessionStore((s) => s.status);
  const autoLockMinutes = useSessionStore((s) => s.autoLockMinutes);
  const lock = useSessionStore((s) => s.lock);

  const lastActivityRef = useRef(Date.now());
  const lastPingRef = useRef(0);

  useEffect(() => {
    if (status !== 'Unlocked') return;

    lastActivityRef.current = Date.now();

    const bump = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastPingRef.current >= 10_000) {
        lastPingRef.current = now;
        void tauriClient.sessionTouchActivity();
      }
    };

    window.addEventListener('keydown', bump, { passive: true });
    window.addEventListener('mousemove', bump, { passive: true });
    window.addEventListener('pointerdown', bump, { passive: true });

    const interval = window.setInterval(() => {
      if (autoLockMinutes <= 0) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= autoLockMinutes * 60_000) {
        void lock('inactivity');
      }
    }, 5_000);

    return () => {
      window.removeEventListener('keydown', bump);
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('pointerdown', bump);
      window.clearInterval(interval);
    };
  }, [status, autoLockMinutes, lock]);
}
