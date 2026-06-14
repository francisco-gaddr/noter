'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker AND makes sure a freshly deployed version takes
 * over without the user having to hard-reload. The old SW served stale HTML/JS,
 * which is why deploys appeared not to land ("går i cirklar"). Now: when a new
 * SW is found we tell it to skipWaiting, and when it takes control we reload once
 * so the page is running the new code immediately.
 */
export default function SWRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const promptUpdate = (reg: ServiceWorkerRegistration) => {
      const waiting = reg.waiting;
      if (waiting) {
        waiting.postMessage('SKIP_WAITING');
        return;
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A new worker is installed while an old one controls the page → activate it.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            reg.waiting?.postMessage('SKIP_WAITING');
          }
        });
      });
    };

    const register = () => {
      navigator.serviceWorker.register('/app/sw.js').then(
        (reg) => {
          promptUpdate(reg);
          // Proactively check for a new SW on load and when the tab refocuses.
          reg.update().catch(() => {});
          const onFocus = () => reg.update().catch(() => {});
          window.addEventListener('focus', onFocus);
        },
        (err) => console.log('ServiceWorker registration failed: ', err)
      );
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
