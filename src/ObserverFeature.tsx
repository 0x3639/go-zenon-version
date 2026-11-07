import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { observerConfiguration } from './observer-config.ts';

export const OBSERVER_CONFIG = observerConfiguration(import.meta.env.VITE_OBSERVER_ENABLED, import.meta.env.VITE_OBSERVER_API_URL, import.meta.env.DEV);
const ObserverPanel = lazy(() => import('./ObserverPanel.tsx'));
class ObserverBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section className="panel" id="observer"><div className="panel-heading"><div><h2>Observer · Experimental</h2><p>The Observer panel could not load. Reload the page to retry.</p></div></div></section> : this.props.children;
  }
}
export function ObserverFeature() {
  if (!OBSERVER_CONFIG.enabled) return null;
  if (OBSERVER_CONFIG.error) return <section className="panel" id="observer"><div className="panel-heading"><div><h2>Observer · Experimental</h2><p>{OBSERVER_CONFIG.error}</p></div></div></section>;
  return <ObserverBoundary><Suspense fallback={<section className="panel" id="observer"><div className="panel-heading"><h2>Loading experimental Observer…</h2></div></section>}><ObserverPanel api={OBSERVER_CONFIG.api} /></Suspense></ObserverBoundary>;
}
