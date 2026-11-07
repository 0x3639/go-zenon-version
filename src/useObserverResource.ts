import { useEffect, useState } from 'react';
import { fetchObserver, ObserverRequestError } from './observer.ts';
import type { ObserverEnvelope } from './observer.ts';

export interface ObserverResource<T> { data: ObserverEnvelope<T> | null; error: string; loading: boolean }

// Every route owns its failure, last success, timer and cancellation scope.
export function useObserverResource<T>(url: string | null, parse: (x: unknown) => ObserverEnvelope<T>, revision = 0): ObserverResource<T> {
  const [state, setState] = useState<ObserverResource<T> & { url: string | null }>({ url, data: null, error: '', loading: !!url });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let stopped = false, busy = false, failures = 0, due = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(s => s.url === url ? { ...s, loading: true } : { url, data: null, error: '', loading: true });
    async function refresh() {
      if (stopped || busy) return;
      clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      if (Date.now() < due) { timer = setTimeout(refresh, due - Date.now()); return; }
      busy = true;
      let delay = 30000;
      try {
        const data = await fetchObserver(url!, parse, controller.signal);
        failures = 0;
        if (!stopped) setState({ url, data, error: '', loading: false });
      } catch (e) {
        delay = Math.max(Math.min(120000, 30000 * 2 ** Math.min(failures++, 2)), e instanceof ObserverRequestError ? e.retryAfterMs : 0);
        if (!stopped) setState(s => ({ ...s, error: e instanceof ObserverRequestError ? e.message : 'Unable to read this Observer feed. Retrying automatically.', loading: false }));
      } finally {
        busy = false; due = Date.now() + delay;
        if (!stopped) timer = setTimeout(refresh, delay);
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [url, parse, revision]);
  return state.url === url ? state : { data: null, error: '', loading: !!url };
}
