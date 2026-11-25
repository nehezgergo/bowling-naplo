/** Kérhető AI-tanács játék közben. A kérés a háttérben fut, közben tovább lehet rögzíteni. */
import { getApiKey, requestLiveAdvice } from '../coach/claude';
import type { LiveAdvice, LiveContext, LiveGame } from '../coach/live';
import { getData } from '../state';
import { esc } from '../util/format';
import { explain } from './glossary';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'done'; label: string; advice: LiveAdvice }
  | { kind: 'error'; message: string };

export interface LiveWidget {
  html: (buttonText: string, disabled?: boolean) => string;
  /** Igaz, ha a kattintás a tanács-gombhoz tartozott. */
  handle: (target: HTMLElement, get: () => { ctx: LiveContext; game?: LiveGame; label: string }) => boolean;
  stop: () => void;
}

/** `refresh`: a befoglaló felület újrarajzolja a widget helyét. */
export function createLiveAdvice(refresh: () => void): LiveWidget {
  let state: State = { kind: 'idle' };
  let controller: AbortController | null = null;

  const ask = async (get: () => { ctx: LiveContext; game?: LiveGame; label: string }) => {
    const apiKey = getApiKey();
    if (!apiKey) state = { kind: 'error', message: 'A tanácshoz előbb add meg az API-kulcsodat: Beállítások → Claude-edző.' };
    else if (!navigator.onLine) state = { kind: 'error', message: 'Nincs internet. A dobásokat így is rögzítheted.' };
    if (!apiKey || !navigator.onLine) return refresh();
    const { ctx, game, label } = get();
    const mine = (controller = new AbortController());
    state = { kind: 'loading', label };
    refresh();
    try {
      const advice = await requestLiveAdvice({ apiKey, data: getData(), ctx, game, signal: mine.signal });
      if (controller === mine) state = { kind: 'done', label, advice };
    } catch (err) {
      if (controller === mine) state = { kind: 'error', message: (err as Error).message };
    }
    if (controller === mine) {
      controller = null;
      refresh();
    }
  };

  const stop = () => {
    const c = controller;
    controller = null;
    c?.abort();
    state = { kind: 'idle' };
  };

  return {
    stop,
    html: (buttonText, disabled = false) => {
      const s = state;
      const panel =
        s.kind === 'done'
          ? `<div class="live-tip" role="status"><div class="focus-label">${esc(s.label)}</div>
              <button type="button" class="icon-btn live-x" data-live="close" aria-label="Tanács bezárása">✕</button>
              <div class="live-now">${explain(s.advice.now)}</div>
              ${s.advice.steps.length ? `<ul>${s.advice.steps.map((x) => `<li>${explain(x)}</li>`).join('')}</ul>` : ''}
              <div class="muted small">${explain(s.advice.why)}</div></div>`
          : s.kind === 'error'
            ? `<div class="import-box error" role="alert">${esc(s.message)}</div>`
            : '';
      return `<div class="live-advice">${panel}${
        s.kind === 'loading'
          ? `<button type="button" class="btn live-ask" data-live="cancel"><span class="spinner" aria-hidden="true"></span>Gondolkodom… (megszakítás)</button>`
          : `<button type="button" class="btn live-ask" data-live="ask" ${disabled ? 'disabled' : ''}>✦ ${esc(buttonText)}</button>`
      }</div>`;
    },
    handle: (target, get) => {
      const act = target.closest<HTMLButtonElement>('[data-live]')?.dataset.live;
      if (!act) return false;
      if (act === 'ask') void ask(get);
      else {
        stop();
        refresh();
      }
      return true;
    },
  };
}
