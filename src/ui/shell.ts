import type { Settings } from '../domain/types';

export function navigate(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** A frissen mentett alkalom, amire a főoldal egyszer visszajelzést mutat. */
let justSaved: string | null = null;
export const setJustSaved = (id: string | null) => (justSaved = id);
export const takeJustSaved = () => {
  const id = justSaved;
  justSaved = null;
  return id;
};

let toastTimer: number | undefined;
export function toast(msg: string, error = false): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = 'toast'), 2600);
}

export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12151c' : '#f6f7fb');
}
