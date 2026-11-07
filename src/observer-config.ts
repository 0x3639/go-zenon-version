export const DEFAULT_OBSERVER_API = 'https://zsjo46q7s0qcmaklbmak7gfp.172.245.238.165.sslip.io';

// A build-time opt-in only. Collection health never enables this experiment.
export function observerConfiguration(flag: unknown, endpoint?: string, development = false) {
  if (flag !== 'true') return { enabled: false, api: '', error: '' };
  try {
    const url = new URL(endpoint?.trim() || DEFAULT_OBSERVER_API);
    const local = development && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return { enabled: true, api: url.origin, error: '' };
  } catch {
    return { enabled: true, api: '', error: 'The Observer API address needs a valid HTTPS origin.' };
  }
}
