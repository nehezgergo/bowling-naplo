/**
 * Frame-enkénti bevitel bábu-ábrával. Minden dobás után azokat a bábukat
 * jelölöd, amelyek ÁLLVA maradtak (jó dobásnál ez a kevesebb koppintás).
 */
import { ALL_PINS, frameMarks, isFrameComplete, isGameComplete, isSplit, leaveKey, scoreGame } from '../domain/scoring';
import type { Frame } from '../domain/types';
import type { LiveContext } from '../coach/live';
import { esc } from '../util/format';
import { createLiveAdvice } from './liveAdvice';

interface EFrame {
  rolls: number[];
  /** Álló bábuk minden dobás után (ha ebben a szerkesztésben vitted be). */
  stand: (number[] | undefined)[];
  pinsLeft?: number[];
  pinsAfter?: number[];
  firstBall?: Frame['firstBall'];
}

const DIR_SHORT: Record<NonNullable<Frame['firstBall']>, string> = { zseb: '◎', bal: '←', jobb: '→' };

export interface FrameEditorOptions {
  title: string;
  frames?: Frame[];
  onDone: (frames: Frame[] | null) => void;
  /** Ha meg van adva, játék közben AI-tanács kérhető. */
  live?: { ctx: LiveContext; gameNo: number; ball?: string };
}

/** A hátsó sortól az első felé, ahogy a nekifutásból látszik (felül a 7–10). */
const ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];

function rackBefore(f: EFrame): { standing: number[]; fresh: boolean } {
  let standing = ALL_PINS;
  let fresh = true;
  f.rolls.forEach((r, k) => {
    if (fresh) {
      if (r === 10) standing = ALL_PINS;
      else {
        standing = f.stand[k] ?? ALL_PINS.slice(r);
        fresh = false;
      }
    } else {
      standing = ALL_PINS;
      fresh = true;
    }
  });
  return { standing, fresh };
}

const toFrame = (f: EFrame): Frame => {
  const out: Frame = { rolls: [...f.rolls] };
  if (f.pinsLeft) out.pinsLeft = f.pinsLeft;
  if (f.pinsAfter) out.pinsAfter = f.pinsAfter;
  if (f.firstBall) out.firstBall = f.firstBall;
  return out;
};

export function openFrameEditor(opts: FrameEditorOptions): void {
  // Dupla koppintásra se nyíljon meg kétszer.
  if (document.querySelector('.fe-overlay:not(.closing)')) return;
  const hadFrames = !!opts.frames?.length;
  const frames: EFrame[] = Array.from({ length: 10 }, (_, i) => {
    const f = opts.frames?.[i];
    return f ? { rolls: [...f.rolls], stand: [], pinsLeft: f.pinsLeft, pinsAfter: f.pinsAfter, firstBall: f.firstBall } : { rolls: [], stand: [] };
  });
  const firstIncomplete = () => {
    const i = frames.findIndex((f, k) => !isFrameComplete(f, k));
    return i === -1 ? 10 : i;
  };
  let cur = firstIncomplete();
  let sel = new Set<number>();
  const live = opts.live ? createLiveAdvice(() => {
    render(true);
    // A megérkezett tanács legyen látható.
    overlay.querySelector('.live-tip, .live-advice .import-box')?.scrollIntoView({ block: 'nearest' });
  }) : null;

  const overlay = document.createElement('div');
  overlay.className = 'fe-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', opts.title);
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Az Android „vissza” gomb zárja a szerkesztőt, ne az oldalt.
  history.pushState({ frameEditor: true }, '');
  const onPop = () => close(undefined, true);
  window.addEventListener('popstate', onPop);

  function close(result: Frame[] | null | undefined, fromPop = false) {
    window.removeEventListener('popstate', onPop);
    live?.stop();
    // Ugyanazon az úton távozik, amin érkezett (lefelé csúszik), aztán eltűnik.
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
    document.body.style.overflow = prevOverflow;
    if (!fromPop) history.back();
    if (result !== undefined) opts.onDone(result);
  }

  const sheetHtml = () => {
    const { cumulative } = scoreGame(frames.map(toFrame));
    return frames
      .map((f, i) => {
        const marks = frameMarks(f);
        const boxes = i === 9 ? 3 : 2;
        const cells: string[] = [];
        if (i < 9 && marks[0] === 'X') cells.push('', 'X');
        else for (let k = 0; k < boxes; k++) cells.push(marks[k] ?? '');
        const split = f.pinsLeft && isSplit(f.pinsLeft) && f.rolls[0] !== 10;
        return `<button type="button" class="fe-cell${i === cur ? ' cur' : ''}${i === 9 ? ' tenth' : ''}" data-frame="${i}" aria-label="${i + 1}. kör">
          <span class="fe-no">${i + 1}${f.firstBall ? `<i class="fe-dir"> ${DIR_SHORT[f.firstBall]}</i>` : ''}</span>
          <span class="fe-marks">${cells.map((c, k) => `<span class="${k === 0 && split ? 'split' : ''}">${esc(c)}</span>`).join('')}</span>
          <span class="fe-cum">${cumulative[i] ?? ''}</span>
        </button>`;
      })
      .join('');
  };

  const render = (keepScroll = false) => {
    const scroll = keepScroll ? (overlay.querySelector('.fe-body')?.scrollTop ?? 0) : 0;
    const done = cur >= 10;
    const f = frames[Math.min(cur, 9)];
    const { standing, fresh } = done ? { standing: [], fresh: true } : rackBefore(f);
    const rollNo = f.rolls.length + 1;
    const knocked = standing.length - sel.size;
    const { total } = scoreGame(frames.map(toFrame));
    const complete = isGameComplete(frames.map(toFrame));
    const leaveInfo = !done && !fresh ? `Megmaradt: ${leaveKey(standing).replace(/-/g, ', ')}${isSplit(standing) ? ' · <button type="button" class="term split-tag" data-term="split">split</button>' : ''}` : '';

    overlay.innerHTML = `
      <div class="fe-top">
        <button type="button" class="btn btn-ghost" data-act="cancel">Mégse</button>
        <div class="fe-title">${esc(opts.title)}</div>
        <button type="button" class="btn btn-primary" data-act="done" ${complete ? '' : 'disabled'}>Kész</button>
      </div>
      <div class="fe-sheet">${sheetHtml()}</div>
      <div class="fe-body">
        ${
          done
            ? `<div class="fe-final"><div class="fe-final-score">${total}</div><div class="muted">Kész a játék. Koppints egy körre a javításhoz.</div></div>`
            : `<div class="fe-status"><b>${cur + 1}. kör · ${rollNo}. dobás</b><span>${leaveInfo}</span></div>
               <div class="fe-hint">Koppints azokra, amelyek <b>állva maradtak</b></div>
               <div class="pins" role="group" aria-label="Bábuk">
                 ${ROWS.map(
                   (row) => `<div class="pin-row">${row
                     .map((p) => {
                       const inRack = standing.includes(p);
                       const on = sel.has(p);
                       return `<button type="button" class="pin${inRack ? '' : ' gone'}${on ? ' up' : ''}" data-pin="${p}" ${inRack ? '' : 'disabled'} aria-pressed="${on}" aria-label="${p}-es bábu${on ? ', áll' : ''}">${p}</button>`;
                     })
                     .join('')}</div>`,
                 ).join('')}
               </div>
               ${actionsHtml(fresh, f.rolls.length === 0, knocked)}
               ${live ? live.html(fresh ? 'Hogyan játsszak tovább?' : 'Hogyan üssem le ezeket?', !frames.some((x) => x.rolls.length)) : ''}`
        }
      </div>
      <div class="fe-bottom">
        <button type="button" class="btn btn-ghost" data-act="undo" ${frames.some((x) => x.rolls.length) ? '' : 'disabled'}>↶ Vissza</button>
        <span class="fe-total">Eddig: <b>${total}</b></span>
        ${hadFrames ? '<button type="button" class="btn btn-ghost danger-text" data-act="clear">Törlés</button>' : '<span></span>'}
      </div>`;
    if (scroll) overlay.querySelector('.fe-body')!.scrollTop = scroll;
  };

  /** Gombsor: első dobás jelölés nélkül / jelölt bábukkal (irány = rögzítés), spare-kísérlet. */
  const actionsHtml = (fresh: boolean, firstOfFrame: boolean, knocked: number) => {
    if (!fresh)
      return `<div class="fe-actions">
        <button type="button" class="btn fe-big fe-ok" data-act="spare">/<small>Mind leütve</small></button>
        <button type="button" class="btn fe-big" data-act="miss">−<small>Egyet sem</small></button>
        <button type="button" class="btn btn-primary fe-big" data-act="commit" ${sel.size === 0 ? 'disabled' : ''}>${knocked}<small>ledöntve</small></button>
      </div>`;
    if (sel.size === 0 || !firstOfFrame)
      return `<div class="fe-actions">
        <button type="button" class="btn fe-big fe-ok" data-act="strike">X<small>Mind ledőlt</small></button>
        <button type="button" class="btn fe-big" data-act="miss">−<small>Egy sem dőlt le</small></button>
        <button type="button" class="btn btn-primary fe-big" data-act="commit" ${sel.size === 0 ? 'disabled' : ''}>${knocked}<small>ledöntve</small></button>
      </div>`;
    return `<div class="fe-hint">${knocked} ledöntve · merre ment a golyó? <span class="muted">(nem kötelező)</span></div>
      <div class="fe-actions fe-dirs">
        <button type="button" class="btn fe-big" data-dir="bal">←<small>Balra</small></button>
        <button type="button" class="btn fe-big fe-ok" data-dir="zseb">◎<small>Jó irány</small></button>
        <button type="button" class="btn fe-big" data-dir="jobb">→<small>Jobbra</small></button>
        <button type="button" class="btn btn-primary fe-big" data-act="commit">✓<small>Rögzít</small></button>
      </div>`;
  };

  const commit = (standingAfter: number[], dir?: Frame['firstBall']) => {
    const f = frames[cur];
    const { standing, fresh } = rackBefore(f);
    if (dir && f.rolls.length === 0) f.firstBall = dir;
    const after = standingAfter.filter((p) => standing.includes(p)).sort((a, b) => a - b);
    f.rolls.push(standing.length - after.length);
    f.stand.push(after);
    if (!fresh) {
      f.pinsLeft = [...standing];
      f.pinsAfter = after;
    }
    sel = new Set();
    if (isFrameComplete(f, cur)) cur = firstIncomplete();
    render();
  };

  const undo = () => {
    let i = cur < 10 && frames[cur].rolls.length ? cur : -1;
    if (i === -1) {
      // Az utolsó, dobást tartalmazó frame a jelenlegi előtt.
      for (let k = Math.min(cur, 10) - 1; k >= 0; k--)
        if (frames[k].rolls.length) {
          i = k;
          break;
        }
    }
    if (i === -1) return;
    const f = frames[i];
    const wasAttempt = f.rolls.length >= 2 && !rackBefore({ ...f, rolls: f.rolls.slice(0, -1), stand: f.stand.slice(0, -1) }).fresh;
    f.rolls.pop();
    f.stand.pop();
    if (wasAttempt) {
      delete f.pinsLeft;
      delete f.pinsAfter;
    }
    if (f.rolls.length === 0) delete f.firstBall;
    cur = i;
    sel = new Set();
    render();
  };

  overlay.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (
      opts.live &&
      live?.handle(t, () => {
        const { standing, fresh } = rackBefore(frames[Math.min(cur, 9)]);
        return {
          ctx: opts.live!.ctx,
          game: { no: opts.live!.gameNo, ball: opts.live!.ball, frames: frames.map(toFrame), standing: fresh ? undefined : standing },
          label: fresh ? `Tanács a(z) ${cur + 1}. körhöz` : `Tanács a(z) ${cur + 1}. kör második dobásához`,
        };
      })
    )
      return;
    const pin = t.closest<HTMLButtonElement>('[data-pin]');
    if (pin && !pin.disabled) {
      const p = Number(pin.dataset.pin);
      if (sel.has(p)) sel.delete(p);
      else sel.add(p);
      render(true);
      return;
    }
    const dirBtn = t.closest<HTMLButtonElement>('[data-dir]');
    if (dirBtn && cur < 10) return commit([...sel], dirBtn.dataset.dir as Frame['firstBall']);
    const cell = t.closest<HTMLButtonElement>('[data-frame]');
    if (cell) {
      const i = Number(cell.dataset.frame);
      if (i === cur) return;
      if (i > firstIncomplete()) return; // előre ugrani nem lehet
      if (frames[i].rolls.length && !confirm(`Újra beviszed a(z) ${i + 1}. kört?`)) return;
      frames[i] = { rolls: [], stand: [] };
      cur = i;
      sel = new Set();
      render();
      return;
    }
    const act = t.closest<HTMLButtonElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (cur < 10) {
      const { standing } = rackBefore(frames[cur]);
      if (act === 'strike' || act === 'spare') return commit([]);
      if (act === 'miss') return commit(standing);
      if (act === 'commit') return commit([...sel]);
    }
    if (act === 'undo') undo();
    else if (act === 'cancel') close(undefined);
    else if (act === 'done') close(frames.map(toFrame));
    else if (act === 'clear' && confirm('Törlöd ennek a játéknak a dobásait? A pontszám megmarad.')) close(null);
  });

  render();
}
