'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { Spinner } from '@/components/form-controls';
import { formatAgo } from '@/lib/ops-view';

const INTERVAL_MS = 30_000;

// A clock that ticks every second; the server (and hydration) render without one.
const subscribeToClock = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const readClock = () => Math.floor(Date.now() / 1000) * 1000;
const noClock = () => null;

/**
 * Re-renders the page's server components every 30s (skipped while the tab is hidden or
 * paused), with a manual refresh and the age of what is on screen.
 */
export function AutoRefresh({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const now = useSyncExternalStore(subscribeToClock, readClock, noClock);
  const lastAttempt = useRef(0);

  const refresh = useCallback(() => {
    lastAttempt.current = Date.now();
    startRefresh(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (paused || refreshing) return;
    const due = () =>
      Date.now() - Date.parse(generatedAt) >= INTERVAL_MS &&
      Date.now() - lastAttempt.current >= INTERVAL_MS;
    const tick = () => {
      if (!document.hidden && due()) refresh();
    };
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [paused, refreshing, generatedAt, refresh]);

  const updated = new Date(generatedAt);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <p className="text-slate-600">
        {refreshing ? (
          'Refreshing…'
        ) : (
          <>
            Updated{' '}
            <time dateTime={generatedAt} title={updated.toISOString()}>
              {now === null ? 'just now' : formatAgo(updated, new Date(now))}
            </time>
          </>
        )}
        <span className="text-slate-400">
          {' · '}
          {paused ? 'auto-refresh paused' : 'auto-refresh every 30s'}
        </span>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setPaused((p) => !p)} className={button}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={refresh} disabled={refreshing} className={button}>
          {refreshing && <Spinner className="size-3.5" />}
          Refresh
        </button>
      </div>
    </div>
  );
}

const button =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-400/25 disabled:cursor-wait disabled:opacity-70';
