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

/**
 * Jól látható visszaigazolás mentés után: középre úszó kártya pipával és összegzéssel.
 * Koppintásra vagy pár másodperc után eltűnik; Androidon röviden rezeg is.
 */
export function showSaved(title: string, lines: string[], ms = 3200): void {
  document.querySelector('.saved-sheet')?.remove();
  const el = document.createElement('div');
  el.className = 'saved-sheet';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'assertive');
  el.innerHTML = `<div class="saved-card">
    <div class="saved-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <div class="saved-title"></div>
    <div class="saved-lines"></div>
    <div class="saved-hint">Koppints a bezáráshoz</div>
  </div>`;
  el.querySelector('.saved-title')!.textContent = title;
  const box = el.querySelector('.saved-lines')!;
  for (const l of lines) {
    const d = document.createElement('div');
    d.textContent = l;
    box.appendChild(d);
  }
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', close);
  document.body.appendChild(el);
  try {
    navigator.vibrate?.(40);
  } catch {
    /* nem támogatott */
  }
  setTimeout(close, ms);
}

export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12151c' : '#f6f7fb');
}
