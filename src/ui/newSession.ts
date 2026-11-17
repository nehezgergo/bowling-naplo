/**
 * Új alkalom / szerkesztés három lépésben:
 *   1. Körülmények (dátum, típus, verseny, helyszín, pálya, golyó, olajozás, mai fókusz)
 *   2. Játékok (végeredmény vagy frame-enként)
 *   3. Összegzés (bemelegítés, hogy ment, verseny-eredmény, megjegyzés) → mentés
 * Az új alkalom piszkozata minden változáskor elmentődik a telefonon, így ha
 * a telefon lezár vagy bezárod az appot, onnan folytathatod, ahol abbahagytad.
 */
import { average } from '../domain/stats';
import { scoreGame } from '../domain/scoring';
import {
  getSessionTypes,
  typeKind,
  typeLabel,
  type Competition,
  type Frame,
  type Game,
  type Session,
  type SessionCoach,
  type Warmup,
  type SessionType,
} from '../domain/types';
import { deleteSession, getData, lastSession, upsertSession } from '../state';
import { esc, fmtAvg, fmtDate, todayIso, uid } from '../util/format';
import { oneAction } from '../coach/oneAction';
import { openFrameEditor } from './frameEditor';
import { navigate, setJustSaved, showSaved, toast } from './shell';

type Step = 1 | 2 | 3;

/** Szerkesztés alatti alkalom: a pontszámok szövegként, amíg gépelsz. */
interface Draft {
  id?: string;
  createdAt?: string;
  step: Step;
  date: string;
  type: SessionType;
  ball: string;
  eventName: string;
  venue: string;
  note: string;
  scores: string[];
  /** Játékonkénti frame-adat (ha részletesen vitted be). */
  frames: (Frame[] | undefined)[];
  /** Játékonkénti golyó; '' = az alkalom golyója. */
  gameBalls: string[];
  coach: SessionCoach;
  competition: Competition;
  warmup: Warmup;
}

/** Régebbi vagy hiányos piszkozatnál a hiányzó mezők pótlása. */
function normalizeDraft(d: Draft): Draft {
  const n = d.scores.length;
  d.frames = Array.from({ length: n }, (_, i) => d.frames?.[i] ?? undefined);
  d.warmup = d.warmup ?? {};
  d.coach = d.coach ?? {};
  d.competition = d.competition ?? {};
  d.gameBalls = Array.from({ length: n }, (_, i) => d.gameBalls?.[i] ?? '');
  d.step = d.step === 2 || d.step === 3 ? d.step : 1;
  return d;
}

const DRAFT_KEY = 'bowling-naplo-draft';

function saveDraftLocal(d: Draft) {
  if (d.id) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* nem kritikus */
  }
}
function loadDraftLocal(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return s ? (JSON.parse(s) as Draft) : null;
  } catch {
    return null;
  }
}
function clearDraftLocal() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nem kritikus */
  }
}

/** A félbehagyott új alkalom rövid leírása a főoldalhoz (ha van benne valami). */
export function pendingDraft(): { date: string; type: string; games: number; step: Step } | null {
  const d = loadDraftLocal();
  if (!d) return null;
  const games = (d.scores ?? []).filter((s) => parseScore(s) !== null).length;
  const step = d.step ?? 1;
  if (games === 0 && step === 1) return null;
  return { date: d.date, type: typeLabel(d.type), games, step };
}
/** Elnavigáláskor: a szerkesztett (régi) alkalom nem mentett állapota elvész; az új alkalom piszkozata megmarad. */
export function leaveSessionEditor(): void {
  if (cache?.key.startsWith('edit:')) cache = null;
}

export function discardDraft(): void {
  clearDraftLocal();
  cache = null;
}

function newDraft(): Draft {
  const last = lastSession();
  return {
    step: 1,
    date: todayIso(),
    type: last && getSessionTypes().some((t) => t.id === last.type) ? last.type : (getSessionTypes().find((t) => t.kind === 'edzes') ?? getSessionTypes()[0]).id,
    ball: last?.ball ?? '',
    eventName: '',
    venue: last?.venue ?? '',
    note: '',
    scores: [''],
    frames: [undefined],
    gameBalls: [''],
    coach: {},
    competition: {},
    warmup: {},
  };
}

function draftFromSession(s: Session): Draft {
  const games = [...s.games].sort((a, b) => a.index - b.index);
  return {
    id: s.id,
    createdAt: s.createdAt,
    step: 2,
    date: s.date,
    type: s.type,
    ball: s.ball ?? '',
    eventName: s.eventName ?? '',
    venue: s.venue ?? '',
    note: s.note ?? '',
    scores: games.map((g) => String(g.score)),
    frames: games.map((g) => g.frames),
    gameBalls: games.map((g) => g.ball ?? ''),
    coach: { ...(s.coach ?? {}) },
    competition: { ...(s.competition ?? {}) },
    warmup: { ...(s.warmup ?? {}) },
  };
}

/** A szerkesztett alkalom a lépések között is megmarad (szerkesztésnél csak memóriában). */
let cache: { key: string; draft: Draft } | null = null;

/** A választható típusok; egy régi alkalom azóta törölt típusa is megjelenik, hogy ne vesszen el. */
function typeChoices(current: string) {
  const list = getSessionTypes().map((t) => ({ id: t.id, label: t.label }));
  if (current && !list.some((t) => t.id === current)) list.push({ id: current, label: typeLabel(current) });
  return list;
}

export const parseScore = (v: string): number | null => {
  const t = v.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= 300 ? n : null;
};

const chips = (field: string, options: { id: string; label: string }[], current: string | undefined) =>
  `<div class="chips" role="group">${options
    .map(
      (o) =>
        `<button type="button" class="chip${o.id === current ? ' on' : ''}" data-field="${field}" data-value="${esc(o.id)}" aria-pressed="${o.id === current}">${esc(o.label)}</button>`,
    )
    .join('')}</div>`;

const scale = (field: string, label: string, current: number | undefined, low: string, high: string) =>
  `<div class="field"><div class="field-label">${label} <span class="hint">${low} → ${high}</span></div>
   ${chips(field, [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: String(n) })), current ? String(current) : undefined)}</div>`;

/** Szöveges mező, ami azonnal a piszkozatba ír (`bind` = mező útvonala, pl. "coach.lanes"). */
const textField = (bind: string, label: string, value: unknown, placeholder = '', area = false) => {
  const id = `f-${bind.replace('.', '-')}`;
  return `<div class="field"><label class="field-label" for="${id}">${label}</label>${
    area
      ? `<textarea id="${id}" data-bind="${bind}" rows="2" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="${id}" data-bind="${bind}" value="${esc(value)}" placeholder="${esc(placeholder)}">`
  }</div>`;
};
const intField = (bind: string, label: string, value: unknown, placeholder = '') => {
  const id = `f-${bind.replace('.', '-')}`;
  return `<div class="field"><label class="field-label" for="${id}">${label}</label><input id="${id}" data-bind="${bind}" data-int inputmode="numeric" maxlength="4" value="${esc(value)}" placeholder="${esc(placeholder)}"></div>`;
};

const clean = <T extends object>(o: T): T | undefined => {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v));
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Körülmények' },
  { n: 2, label: 'Játékok' },
  { n: 3, label: 'Összegzés' },
];

export function renderNewSession(root: HTMLElement, params: URLSearchParams): void {
  const editId = params.get('id');
  const existing = editId ? getData().sessions.find((s) => s.id === editId) : undefined;
  const key = existing ? `edit:${existing.id}` : 'new';
  if (!cache || cache.key !== key)
    cache = { key, draft: normalizeDraft(existing ? draftFromSession(existing) : (loadDraftLocal() ?? newDraft())) };
  const draft = cache.draft;
  const balls = getData().settings.balls;
  const persist = () => saveDraftLocal(draft);

  const validScores = () => draft.scores.map(parseScore).filter((n): n is number => n !== null);
  const summaryText = () => {
    const v = validScores();
    return v.length ? `${v.length} játék · átlag ${fmtAvg(average(v))} · összesen ${v.reduce((a, b) => a + b, 0)}` : 'Még nincs rögzített játék.';
  };

  const stepper = () => `<nav class="stepper" aria-label="Lépések">${STEPS.map(
    (s) => `<button type="button" class="step${s.n === draft.step ? ' on' : ''}${s.n < draft.step ? ' done' : ''}" data-step="${s.n}" aria-current="${s.n === draft.step ? 'step' : 'false'}">
      <span class="step-n">${s.n < draft.step ? '✓' : s.n}</span><span class="step-l">${s.label}</span></button>`,
  ).join('')}</nav>`;

  const conditionsLine = () => {
    const parts = [fmtDate(draft.date), typeLabel(draft.type), draft.eventName, draft.venue, draft.coach.lanes ? `${draft.coach.lanes}. pálya` : '', draft.ball].filter(Boolean);
    return `<div class="cond-line"><span>${parts.map(esc).join(' · ')}</span><button type="button" class="btn btn-ghost" data-step="1">Módosít</button></div>`;
  };

  // ───────────── 1. Körülmények ─────────────
  const step1 = () => {
    const c = draft.coach;
    return `
      <div class="field"><label class="field-label" for="date">Dátum</label><input id="date" type="date" value="${esc(draft.date)}"></div>
      <div class="field"><div class="field-label">Típus</div>${chips('type', typeChoices(draft.type), draft.type)}</div>
      ${textField('eventName', 'Verseny / bajnokság neve', draft.eventName, 'pl. XXVI. Hivatal Kupa, Őszi liga 3. forduló')}
      <div class="row2">
        ${textField('venue', 'Helyszín', draft.venue, 'pl. Gutenberg')}
        ${textField('coach.lanes', 'Pálya', c.lanes, 'pl. 5–6')}
      </div>
      <div class="field"><div class="field-label">Golyó</div>${chips('ball', balls.map((b) => ({ id: b, label: b })), draft.ball)}</div>
      <div class="field"><div class="field-label">Olajozás</div>${chips('coach.oil', [
        { id: 'rovid', label: 'Rövid' },
        { id: 'kozepes', label: 'Közepes' },
        { id: 'hosszu', label: 'Hosszú' },
        { id: 'ismeretlen', label: 'Nem tudom' },
      ], c.oil)}</div>
      <div class="field"><div class="field-label">Pálya állapota</div>${chips('coach.laneCondition', [
        { id: 'szaraz', label: 'Száraz' },
        { id: 'normal', label: 'Normál' },
        { id: 'olajos', label: 'Olajos' },
      ], c.laneCondition)}</div>
      ${textField('coach.target', 'Célpont, vonal', c.target, 'pl. 2. nyíl, 10-es board')}
      ${textField('coach.focusGoal', 'Mai fókusz', c.focusGoal, 'pl. spare-ek, egyenletes tempó')}
      <div class="form-actions">
        ${existing ? '<span></span>' : '<button type="button" class="btn btn-ghost" id="resetBtn">Elvetés</button>'}
        <button type="button" class="btn btn-primary btn-lg" data-step="2">Tovább: játékok →</button>
      </div>`;
  };

  // ───────────── 2. Játékok ─────────────
  const gameCard = (v: string, i: number) => {
    const hasFrames = !!draft.frames[i];
    const gb = draft.gameBalls[i];
    const invalid = v !== '' && parseScore(v) === null;
    return `<div class="game-card${hasFrames ? ' has-frames' : ''}">
      <div class="gc-head">
        <b>${i + 1}. játék</b>
        <span class="gc-tools">
          <button type="button" class="game-ball${gb ? ' set' : ''}" data-ballcycle="${i}" aria-label="${i + 1}. játék golyója: ${esc(gb || 'az alkalom golyója')}">${esc(gb || draft.ball || 'golyó')}</button>
          ${draft.scores.length > 1 ? `<button type="button" class="icon-btn" data-remove="${i}" aria-label="${i + 1}. játék törlése">✕</button>` : ''}
        </span>
      </div>
      <div class="gc-body">
        <div class="gc-score">
          <label class="gc-label" for="g${i}">${hasFrames ? 'Pontszám (frame-ekből)' : 'Végeredmény'}</label>
          <input id="g${i}" class="game-input${invalid ? ' invalid' : ''}" data-i="${i}" inputmode="numeric" pattern="[0-9]*" maxlength="3"
            enterkeyhint="next" autocomplete="off" placeholder="pl. 156" value="${esc(v)}" ${hasFrames ? 'readonly' : ''}>
        </div>
        <span class="gc-or">vagy</span>
        <button type="button" class="btn gc-frames${hasFrames ? ' on' : ''}" data-frames="${i}">▦<small>${hasFrames ? 'Frame-ek' : 'Frame-enként'}</small></button>
      </div>
      ${invalid ? '<div class="gc-err">0 és 300 közötti egész szám legyen.</div>' : ''}
    </div>`;
  };

  const step2 = () => `
    ${conditionsLine()}
    <p class="muted small">Minden játéknál <b>vagy</b> írd be a végeredményt (a kijelző szerinti pontszámot), <b>vagy</b> rögzítsd frame-enként a bábukkal. Ez utóbbiból lesz a strike-, spare- és állás-statisztika.</p>
    <div id="games">${draft.scores.map(gameCard).join('')}</div>
    <button type="button" class="btn btn-ghost add-game" id="addGame">+ Következő játék</button>
    <div class="games-summary" id="gamesSummary">${summaryText()}</div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-step="1">← Vissza</button>
      <button type="button" class="btn btn-primary btn-lg" data-step="3">Lezárás →</button>
    </div>`;

  // ───────────── 3. Összegzés ─────────────
  const step3 = () => {
    const c = draft.coach;
    const comp = draft.competition;
    const w = draft.warmup;
    const v = validScores();
    const isComp = typeKind(draft.type) === 'verseny';
    return `
      <section class="card sum-card">
        <div class="muted small">${esc([fmtDate(draft.date), typeLabel(draft.type), draft.eventName].filter(Boolean).join(' · '))}</div>
        <div class="sum-scores">${v.map((s) => `<span class="score">${s}</span>`).join('')}</div>
        <div class="sum-line">${v.length ? `Átlag <b>${fmtAvg(average(v))}</b> · összesen ${v.reduce((a, b) => a + b, 0)} · legjobb ${Math.max(...v)}` : 'Nincs játék.'}</div>
        <button type="button" class="btn btn-ghost" data-step="2">Játékok módosítása</button>
      </section>
      <p class="muted small">Az alábbiak nem kötelezők, de ezekből tud az edző és az elemzés dolgozni.</p>

      <h2 class="step-h">Bemelegítés</h2>
      <div class="row2">
        ${intField('warmup.shots', 'Bemelegítő dobás', w.shots, 'pl. 8')}
        ${intField('warmup.minutes', 'Időtartam (perc)', w.minutes, 'pl. 10')}
      </div>
      ${textField('warmup.routine', 'Rutin', w.routine, 'pl. nyújtás, 4 üres lendítés, 2 dobás a 10-esre', true)}

      <h2 class="step-h">Hogy ment?</h2>
      ${c.focusGoal ? `<div class="field"><div class="field-label">Sikerült a fókusz? <span class="hint">„${esc(c.focusGoal)}”</span></div>${chips('coach.focusResult', [
        { id: 'igen', label: 'Igen' },
        { id: 'reszben', label: 'Részben' },
        { id: 'nem', label: 'Nem' },
      ], c.focusResult)}</div>` : ''}
      ${scale('coach.freshness', 'Fáradtság', c.fatigue ? 6 - c.fatigue : undefined, 'kimerült', 'friss')}
      ${scale('coach.concentration', 'Koncentráció', c.concentration, 'szétszórt', 'fókuszált')}
      ${scale('coach.selfRating', 'Önértékelés', c.selfRating, 'gyenge', 'kiváló')}
      ${textField('coach.wentWell', 'Mi ment jól?', c.wentWell, '', true)}
      ${textField('coach.wentBad', 'Mi nem ment?', c.wentBad, '', true)}

      <details class="more"${isComp ? ' open' : ''}>
        <summary>Verseny-eredmény <span class="hint">helyezés, csapat</span></summary>
        <div class="row2">
          ${intField('competition.ownRank', 'Saját helyezés', comp.ownRank)}
          ${intField('competition.entrants', 'Indulók száma', comp.entrants)}
        </div>
        ${textField('competition.teamName', 'Csapatnév', comp.teamName)}
        <div class="row2">
          ${intField('competition.teamRank', 'Csapat helyezése', comp.teamRank)}
          ${intField('competition.teamsCount', 'Csapatok száma', comp.teamsCount)}
        </div>
      </details>

      ${textField('note', 'Megjegyzés', draft.note, '', true)}

      ${existing ? '<button type="button" class="btn btn-danger del-btn" id="deleteBtn">Alkalom törlése</button>' : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-step="2">← Vissza</button>
        <button type="button" class="btn btn-primary btn-lg" id="saveBtn">${existing ? 'Mentés' : 'Mentés és lezárás'}</button>
      </div>`;
  };

  const render = () => {
    root.innerHTML = `
      <h1 class="page-title">${existing ? 'Alkalom szerkesztése' : 'Új alkalom'}</h1>
      ${stepper()}
      <form id="sessionForm" class="form" novalidate>${draft.step === 1 ? step1() : draft.step === 2 ? step2() : step3()}</form>`;
    bind();
    window.scrollTo(0, 0);
  };

  /** Ellenőrzés lépésváltás előtt: a 3. lépéshez legalább egy érvényes játék kell. */
  const go = (to: Step) => {
    if (to === draft.step) return;
    if (to === 3) {
      if (draft.scores.some((s) => s.trim() !== '' && parseScore(s) === null)) return void toast('Van hibás pontszám (0–300 közötti egész szám kell).', true);
      if (validScores().length === 0) {
        if (draft.step !== 2) {
          draft.step = 2;
          persist();
          render();
        }
        toast('Rögzíts legalább egy játékot.', true);
        root.querySelector<HTMLInputElement>('.game-input')?.focus();
        return;
      }
    }
    draft.step = to;
    persist();
    render();
  };

  const rerenderGames = (focusIndex?: number) => {
    const el = root.querySelector<HTMLElement>('#games');
    if (!el) return;
    el.innerHTML = draft.scores.map(gameCard).join('');
    root.querySelector('#gamesSummary')!.textContent = summaryText();
    if (focusIndex !== undefined) {
      const inp = el.querySelector<HTMLInputElement>(`#g${focusIndex}`);
      inp?.focus();
      inp?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    persist();
  };

  const addGame = () => {
    draft.scores.push('');
    draft.frames.push(undefined);
    draft.gameBalls.push('');
    rerenderGames(draft.scores.length - 1);
  };

  const save = async () => {
    const keep = draft.scores.map((_, i) => i).filter((i) => draft.scores[i].trim() !== '');
    const parsed = keep.map((i) => parseScore(draft.scores[i]));
    if (parsed.some((n) => n === null)) return void toast('Van hibás pontszám (0–300 közötti egész szám kell).', true);
    if (parsed.length === 0) return void go(2);
    const now = new Date().toISOString();
    const session: Session = {
      id: draft.id ?? uid(),
      date: draft.date,
      type: draft.type,
      ball: draft.ball || undefined,
      eventName: draft.eventName || undefined,
      venue: draft.venue || undefined,
      note: draft.note || undefined,
      coach: clean(draft.coach),
      competition: clean(draft.competition),
      warmup: clean(draft.warmup),
      games: keep.map((di, k) => {
        const g: Game = { index: k + 1, score: parsed[k] as number };
        if (draft.gameBalls[di]) g.ball = draft.gameBalls[di];
        if (draft.frames[di]) g.frames = draft.frames[di];
        return g;
      }),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    };
    await upsertSession(session);
    clearDraftLocal();
    cache = null;
    if (!existing) setJustSaved(session.id);
    const scoresSaved = parsed as number[];
    showSaved(
      existing ? 'Módosítás mentve' : 'Alkalom rögzítve',
      [
        `${fmtDate(session.date)} · ${typeLabel(session.type)}`,
        `${scoresSaved.length} játék: ${scoresSaved.join(', ')}`,
        `Átlag ${fmtAvg(average(scoresSaved))} · legjobb ${Math.max(...scoresSaved)}`,
      ],
      7000,
      oneAction(getData().sessions, getData().settings.profile),
    );
    navigate(existing ? '#/naplo' : '#/');
  };

  function bind() {
    const form = root.querySelector<HTMLFormElement>('#sessionForm')!;
    form.addEventListener('submit', (e) => e.preventDefault());

    root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step) as Step)));

    // Szöveges és szám-mezők: azonnal a piszkozatba.
    form.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (el.id === 'date') {
        draft.date = el.value || todayIso();
        return persist();
      }
      const path = el.dataset.bind;
      if (!path) return;
      let value: unknown = el.value.trim() || undefined;
      if ('int' in el.dataset && value !== undefined) {
        el.value = el.value.replace(/\D/g, '').slice(0, 4);
        value = el.value === '' ? undefined : Number(el.value);
      }
      const [a, b] = path.split('.');
      if (b) (draft[a as 'coach' | 'competition' | 'warmup'] as Record<string, unknown>)[b] = value;
      else (draft as unknown as Record<string, unknown>)[a] = (value as string | undefined) ?? '';
      persist();
    });

    form.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest<HTMLButtonElement>('.chip');
      if (chip) {
        const field = chip.dataset.field!;
        const value = chip.dataset.value!;
        const group = chip.parentElement!;
        const turnOff = chip.classList.contains('on') && field !== 'type';
        group.querySelectorAll('.chip').forEach((b) => {
          b.classList.remove('on');
          b.setAttribute('aria-pressed', 'false');
        });
        if (!turnOff) {
          chip.classList.add('on');
          chip.setAttribute('aria-pressed', 'true');
        }
        const v = turnOff ? undefined : value;
        if (field === 'type') draft.type = value as SessionType;
        else if (field === 'ball') draft.ball = v ?? '';
        else if (field.startsWith('coach.')) {
          // A fáradtság kijelzése fordított (1 = kimerült … 5 = friss), a tárolt érték marad (1 = friss … 5 = kimerült).
          if (field === 'coach.freshness') {
            draft.coach.fatigue = v === undefined ? undefined : ((6 - Number(v)) as SessionCoach['fatigue']);
            return persist();
          }
          const key = field.slice(6) as keyof SessionCoach;
          const isScale = key === 'fatigue' || key === 'concentration' || key === 'selfRating';
          (draft.coach as Record<string, unknown>)[key] = v === undefined ? undefined : isScale ? Number(v) : v;
        }
        return persist();
      }
      const rm = t.closest<HTMLButtonElement>('[data-remove]');
      if (rm) {
        const i = Number(rm.dataset.remove);
        if ((draft.frames[i] || draft.scores[i]) && !confirm(`Törlöd a(z) ${i + 1}. játékot?`)) return;
        draft.scores.splice(i, 1);
        draft.frames.splice(i, 1);
        draft.gameBalls.splice(i, 1);
        return rerenderGames();
      }
      const bc = t.closest<HTMLButtonElement>('[data-ballcycle]');
      if (bc) {
        // Egy koppintás: a következő golyó (az utolsó után vissza az alkalom golyójára).
        const i = Number(bc.dataset.ballcycle);
        const options = ['', ...balls];
        draft.gameBalls[i] = options[(options.indexOf(draft.gameBalls[i]) + 1) % options.length];
        return rerenderGames();
      }
      const fb = t.closest<HTMLButtonElement>('[data-frames]');
      if (fb) {
        const i = Number(fb.dataset.frames);
        openFrameEditor({
          title: `${i + 1}. játék`,
          frames: draft.frames[i],
          onDone: (frames) => {
            draft.frames[i] = frames ?? undefined;
            if (frames) draft.scores[i] = String(scoreGame(frames).total);
            rerenderGames();
          },
        });
      }
    });

    const gamesEl = root.querySelector<HTMLElement>('#games');
    gamesEl?.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      if (!inp.classList.contains('game-input')) return;
      inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
      draft.scores[Number(inp.dataset.i)] = inp.value;
      inp.classList.toggle('invalid', inp.value !== '' && parseScore(inp.value) === null);
      root.querySelector('#gamesSummary')!.textContent = summaryText();
      persist();
    });
    gamesEl?.addEventListener('keydown', (e) => {
      const inp = e.target as HTMLInputElement;
      if (!inp.classList.contains('game-input') || e.key !== 'Enter') return;
      e.preventDefault();
      const i = Number(inp.dataset.i);
      if (inp.value === '') return;
      if (i === draft.scores.length - 1) addGame();
      else gamesEl.querySelector<HTMLInputElement>(`#g${i + 1}`)?.focus();
    });
    root.querySelector('#addGame')?.addEventListener('click', addGame);
    root.querySelector('#saveBtn')?.addEventListener('click', save);

    root.querySelector('#resetBtn')?.addEventListener('click', () => {
      if (pendingDraft() && !confirm('Elveted ezt a félbehagyott alkalmat?')) return;
      discardDraft();
      renderNewSession(root, params);
    });

    root.querySelector('#deleteBtn')?.addEventListener('click', async () => {
      if (!existing) return;
      if (!confirm('Biztosan törlöd ezt az alkalmat? Ez nem vonható vissza.')) return;
      await deleteSession(existing.id);
      cache = null;
      toast('Alkalom törölve');
      navigate('#/naplo');
    });
  }

  render();
}
