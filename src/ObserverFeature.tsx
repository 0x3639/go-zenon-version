import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { observerConfiguration } from './observer-config.ts';

export const OBSERVER_CONFIG = observerConfiguration(import.meta.env.VITE_OBSERVER_ENABLED, import.meta.env.VITE_OBSERVER_API_URL, import.meta.env.DEV);
const AssociationEvidence = lazy(() => import('./AssociationEvidence.tsx'));
const ObserverPanel = lazy(() => import('./ObserverPanel.tsx'));
class ObserverBoundary extends Component<{ children: ReactNode; detail?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section className="panel" id={this.props.detail ? undefined : "observer"}><div className="panel-heading"><div><h2>Observer · Experimental</h2><p>The Observer panel could not load. Reload the page to retry.</p></div></div></section> : this.props.children;
  }
}
export function ObserverFeature() {
  if (!OBSERVER_CONFIG.enabled) return null;
  if (OBSERVER_CONFIG.error) return <section className="panel" id="observer"><div className="panel-heading"><div><h2>Observer · Experimental</h2><p>{OBSERVER_CONFIG.error}</p></div></div></section>;
  return <ObserverBoundary><Suspense fallback={<section className="panel" id="observer"><div className="panel-heading"><h2>Loading experimental Observer…</h2></div></section>}><ObserverPanel api={OBSERVER_CONFIG.api} /></Suspense></ObserverBoundary>;
}

// This action is rendered once for the selected producing address, never once per slot.
export function PillarRelayEvidence({ producer, pillarName, onOpen }: { producer: string; pillarName: string; onOpen?: () => void }) {
  const [opened, setOpened] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!opened || !OBSERVER_CONFIG.enabled) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, 5000);
    return () => clearInterval(timer);
  }, [opened]);
  if (!OBSERVER_CONFIG.enabled) return null;
  return <div className="pillar-relay-evidence">
    <div className="pillar-relay-heading"><span><b>Observed relay versions</b><small>{pillarName} · selected producing address</small></span><button aria-expanded={opened} onClick={() => { if (!opened) onOpen?.(); setOpened(v => !v); }}>{opened ? 'Close relay evidence' : 'View relay evidence'}</button></div>
    {!opened && <p>Evidence not loaded. These versions describe relays; the pillar’s software version is unchanged.</p>}
    {opened && (OBSERVER_CONFIG.error ? <p>{OBSERVER_CONFIG.error}</p> : <ObserverBoundary detail><Suspense fallback={<p>Reading relay evidence…</p>}><AssociationEvidence api={OBSERVER_CONFIG.api} producer={producer} now={now} embedded /></Suspense></ObserverBoundary>)}
  </div>;
}
