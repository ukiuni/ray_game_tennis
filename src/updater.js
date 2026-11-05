// Service worker registration + update policy.
// Updates are checked periodically, downloaded in the background and only
// applied (skipWaiting + reload) when the game says it is safe (not mid-game).

export const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Pure update policy, independent from the browser APIs (unit tested).
 * deps: { isSafe(): boolean, activate(): void, notify?(msg) }
 */
export class UpdatePolicy {
  constructor(deps) {
    this.deps = deps;
    this.pending = false;
    this.applying = false;
  }
  /** A new version finished downloading and is waiting. */
  onUpdateReady() {
    this.pending = true;
    this.deps.notify?.('ready');
    this.tryApply();
  }
  /** Call whenever the app state changes. Returns true if an update was applied. */
  tryApply(force = false) {
    if (!this.pending || this.applying) return false;
    if (!force && !this.deps.isSafe()) return false;
    this.applying = true;
    this.deps.notify?.('applying');
    this.deps.activate();
    return true;
  }
}

export function initUpdater({ isSafe, notify }) {
  let reg = null;
  const policy = new UpdatePolicy({
    isSafe,
    notify,
    activate: () => {
      if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      else location.reload();
    },
  });
  if (!('serviceWorker' in navigator)) return policy;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // only reload when we asked for it (first install also fires controllerchange)
    if (!policy.applying || reloading) return;
    reloading = true;
    location.reload();
  });

  const watch = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) policy.onUpdateReady();
    });
  };

  const check = () => {
    if (reg && navigator.onLine !== false) reg.update().catch(() => {});
  };

  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((r) => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) policy.onUpdateReady();
      watch(r.installing);
      r.addEventListener('updatefound', () => watch(r.installing));
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    })
    .catch((err) => console.warn('SW registration failed', err));

  policy.checkNow = check;
  return policy;
}
