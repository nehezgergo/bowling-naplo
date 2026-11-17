import { average } from '../domain/stats';
import { scoreGame } from '../domain/scoring';
import {
  getSessionTypes,
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

/** Szerkesztés alatti alkalom: a pontszámok szövegként, amíg gépelsz. */
interface Draft {
  id?: string;
  createdAt?: string;
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

/** Régebbi vagy hiányos piszkozatnál a párhuzamos tömbök hosszának igazítása. */
function normalizeDraft(d: Draft): Draft {
  const n = d.scores.length;
  d.frames = Array.from({ length: n }, (_, i) => d.frames?.[i] ?? undefined);
  d.warmup = d.warmup ?? {};
  d.gameBalls = Array.from({ length: n }, (_, i) => d.gameBalls?.[i] ?? '');
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

function newDraft(): Draft {
  const last = lastSession();
  return {
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

const clean = <T extends object>(o: T): T | undefined => {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !Number.isNaN(v));
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

export function renderNewSession(root: HTMLElement, params: URLSearchParams): void {
  const editId = params.get('id');
  const existing = editId ? getData().sessions.find((s) => s.id === editId) : undefined;
  const draft: Draft = normalizeDraft(existing ? draftFromSession(existing) : (loadDraftLocal() ?? newDraft()));
  const balls = getData().settings.balls;

  const gamesHtml = () =>
    draft.scores
      .map((v, i) => {
        const hasFrames = !!draft.frames[i];
        const gb = draft.gameBalls[i];
        return `
      <div class="game-row">
        <label class="game-no" for="g${i}">${i + 1}.</label>
        <input id="g${i}" class="game-input${v && parseScore(v) === null ? ' invalid' : ''}${hasFrames ? ' has-frames' : ''}" data-i="${i}"
          inputmode="numeric" pattern="[0-9]*" maxlength="3" enterkeyhint="next" autocomplete="off"
          placeholder="0–300" value="${esc(v)}" aria-label="${i + 1}. játék pontszáma" ${hasFrames ? 'readonly' : ''}>
        <button type="button" class="game-ball${gb ? ' set' : ''}" data-ballcycle="${i}" aria-label="${i + 1}. játék golyója: ${esc(gb || 'az alkalom golyója')}">${esc(gb || 'golyó')}</button>
        <button type="button" class="icon-btn frames-btn${hasFrames ? ' on' : ''}" data-frames="${i}" aria-label="${i + 1}. játék frame-enként${hasFrames ? ' (rögzítve)' : ''}">▦</button>
        ${draft.scores.length > 1 ? `<button type="button" class="icon-btn" data-remove="${i}" aria-label="${i + 1}. játék törlése">✕</button>` : ''}
      </div>`;
      })
      .join('');

  const summaryText = () => {
    const valid = draft.scores.map(parseScore).filter((n): n is number => n !== null);
    return valid.length ? `${valid.length} játék · átlag ${fmtAvg(average(valid))} · összesen ${valid.reduce((a, b) => a + b, 0)}` : '';
  };

  const c = draft.coach;
  const comp = draft.competition;
  root.innerHTML = `
    <h1 class="page-title">${existing ? 'Alkalom szerkesztése' : 'Új alkalom'}</h1>
    <form id="sessionForm" class="form" novalidate>
      <div class="field">
        <label class="field-label" for="date">Dátum</label>
        <input id="date" type="date" value="${esc(draft.date)}" required>
      </div>
      <div class="field"><div class="field-label">Típus</div>${chips('type', typeChoices(draft.type), draft.type)}</div>
      <div class="field"><div class="field-label">Golyó</div>${chips('ball', balls.map((b) => ({ id: b, label: b })), draft.ball)}</div>

      <div class="field">
        <div class="field-label">Játékok</div>
        <div id="games">${gamesHtml()}</div>
        <button type="button" class="btn btn-ghost" id="addGame">+ játék</button>
        <div class="games-summary" id="gamesSummary">${summaryText()}</div>
      </div>

      <details class="more"${draft.warmup.shots !== undefined || draft.warmup.minutes !== undefined || draft.warmup.routine ? ' open' : ''}>
        <summary>Bemelegítés <span class="hint">dobások, idő, rutin</span></summary>
        <div class="row2">
          <div class="field"><label class="field-label" for="wuShots">Bemelegítő dobás</label>
            <input id="wuShots" inputmode="numeric" maxlength="3" placeholder="pl. 8" value="${esc(draft.warmup.shots)}"></div>
          <div class="field"><label class="field-label" for="wuMinutes">Időtartam (perc)</label>
            <input id="wuMinutes" inputmode="numeric" maxlength="3" placeholder="pl. 10" value="${esc(draft.warmup.minutes)}"></div>
        </div>
        <div class="field"><label class="field-label" for="wuRoutine">Rutin</label>
          <textarea id="wuRoutine" rows="2" placeholder="pl. nyújtás, 4 üres lendítés, 2 spare-dobás a 10-esre">${esc(draft.warmup.routine)}</textarea></div>
      </details>

      <details class="more">
        <summary>Részletek <span class="hint">helyszín, verseny neve, megjegyzés</span></summary>
        <div class="field"><label class="field-label" for="venue">Pálya, helyszín</label><input id="venue" value="${esc(draft.venue)}"></div>
        <div class="field"><label class="field-label" for="eventName">Verseny neve</label><input id="eventName" value="${esc(draft.eventName)}"></div>
        <div class="field"><label class="field-label" for="note">Megjegyzés</label><textarea id="note" rows="2">${esc(draft.note)}</textarea></div>
      </details>

      <details class="more">
        <summary>Az edzőnek <span class="hint">állapot, pálya, fókusz</span></summary>
        ${scale('coach.fatigue', 'Fáradtság', c.fatigue, 'friss', 'kimerült')}
        ${scale('coach.concentration', 'Koncentráció', c.concentration, 'szétszórt', 'fókuszált')}
        ${scale('coach.selfRating', 'Önértékelés', c.selfRating, 'gyenge', 'kiváló')}
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
        <div class="field"><label class="field-label" for="lanes">Pályaszám</label><input id="lanes" value="${esc(c.lanes)}" placeholder="pl. 5–6"></div>
        <div class="field"><label class="field-label" for="target">Célpont, vonal</label><input id="target" value="${esc(c.target)}" placeholder="pl. 2. nyíl, 10-es board"></div>
        <div class="field"><label class="field-label" for="focusGoal">Mai fókusz</label><input id="focusGoal" value="${esc(c.focusGoal)}" placeholder="pl. spare-ek, egyenletes tempó"></div>
        <div class="field"><div class="field-label">Sikerült a fókusz?</div>${chips('coach.focusResult', [
          { id: 'igen', label: 'Igen' },
          { id: 'reszben', label: 'Részben' },
          { id: 'nem', label: 'Nem' },
        ], c.focusResult)}</div>
        <div class="field"><label class="field-label" for="wentWell">Mi ment jól?</label><textarea id="wentWell" rows="2">${esc(c.wentWell)}</textarea></div>
        <div class="field"><label class="field-label" for="wentBad">Mi nem ment?</label><textarea id="wentBad" rows="2">${esc(c.wentBad)}</textarea></div>
      </details>

      <details class="more">
        <summary>Verseny <span class="hint">helyezés, csapat</span></summary>
        <div class="row2">
          <div class="field"><label class="field-label" for="ownRank">Saját helyezés</label><input id="ownRank" inputmode="numeric" value="${esc(comp.ownRank)}"></div>
          <div class="field"><label class="field-label" for="entrants">Indulók száma</label><input id="entrants" inputmode="numeric" value="${esc(comp.entrants)}"></div>
        </div>
        <div class="field"><label class="field-label" for="teamName">Csapatnév</label><input id="teamName" value="${esc(comp.teamName)}"></div>
        <div class="row2">
          <div class="field"><label class="field-label" for="teamRank">Csapat helyezése</label><input id="teamRank" inputmode="numeric" value="${esc(comp.teamRank)}"></div>
          <div class="field"><label class="field-label" for="teamsCount">Csapatok száma</label><input id="teamsCount" inputmode="numeric" value="${esc(comp.teamsCount)}"></div>
        </div>
      </details>

      <div class="form-actions">
        ${existing ? '<button type="button" class="btn btn-danger" id="deleteBtn">Törlés</button>' : '<button type="button" class="btn btn-ghost" id="resetBtn">Ürítés</button>'}
        <button type="submit" class="btn btn-primary btn-lg">Mentés</button>
      </div>
    </form>`;

  const form = root.querySelector<HTMLFormElement>('#sessionForm')!;
  const gamesEl = root.querySelector<HTMLElement>('#games')!;
  const summaryEl = root.querySelector<HTMLElement>('#gamesSummary')!;
  const val = (id: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value.trim();
  const num = (id: string) => {
    const v = val(id);
    return v === '' ? undefined : Number(v);
  };

  const readFields = () => {
    draft.date = val('date') || todayIso();
    draft.venue = val('venue');
    draft.eventName = val('eventName');
    draft.note = val('note');
    Object.assign(draft.coach, {
      lanes: val('lanes') || undefined,
      target: val('target') || undefined,
      focusGoal: val('focusGoal') || undefined,
      wentWell: val('wentWell') || undefined,
      wentBad: val('wentBad') || undefined,
    });
    const intIn = (id: string, max: number) => {
      const n = num(id);
      return n !== undefined && Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
    };
    draft.warmup = { shots: intIn('wuShots', 300), minutes: intIn('wuMinutes', 300), routine: val('wuRoutine') || undefined };
    draft.competition = {
      ownRank: num('ownRank'),
      entrants: num('entrants'),
      teamName: val('teamName') || undefined,
      teamRank: num('teamRank'),
      teamsCount: num('teamsCount'),
    };
  };

  const rerenderGames = (focusIndex?: number) => {
    gamesEl.innerHTML = gamesHtml();
    summaryEl.textContent = summaryText();
    if (focusIndex !== undefined) gamesEl.querySelector<HTMLInputElement>(`#g${focusIndex}`)?.focus();
    saveDraftLocal(draft);
  };

  const addGame = () => {
    draft.scores.push('');
    draft.frames.push(undefined);
    draft.gameBalls.push('');
    rerenderGames(draft.scores.length - 1);
  };

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
        const key = field.slice(6) as keyof SessionCoach;
        const isScale = key === 'fatigue' || key === 'concentration' || key === 'selfRating';
        (draft.coach as Record<string, unknown>)[key] = v === undefined ? undefined : isScale ? Number(v) : v;
      }
      saveDraftLocal(draft);
      return;
    }
    const rm = t.closest<HTMLButtonElement>('[data-remove]');
    if (rm) {
      const i = Number(rm.dataset.remove);
      if (draft.frames[i] && !confirm(`A ${i + 1}. játékhoz frame-adat is tartozik. Törlöd a játékot?`)) return;
      draft.scores.splice(i, 1);
      draft.frames.splice(i, 1);
      draft.gameBalls.splice(i, 1);
      rerenderGames();
      return;
    }
    const bc = t.closest<HTMLButtonElement>('[data-ballcycle]');
    if (bc) {
      // Egy koppintás: a következő golyó (az utolsó után vissza az alkalom golyójára).
      const i = Number(bc.dataset.ballcycle);
      const options = ['', ...balls];
      draft.gameBalls[i] = options[(options.indexOf(draft.gameBalls[i]) + 1) % options.length];
      rerenderGames();
      return;
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

  gamesEl.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.classList.contains('game-input')) return;
    inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
    draft.scores[Number(inp.dataset.i)] = inp.value;
    inp.classList.toggle('invalid', inp.value !== '' && parseScore(inp.value) === null);
    summaryEl.textContent = summaryText();
    saveDraftLocal(draft);
  });

  gamesEl.addEventListener('keydown', (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.classList.contains('game-input') || e.key !== 'Enter') return;
    e.preventDefault();
    const i = Number(inp.dataset.i);
    if (inp.value === '') return;
    if (i === draft.scores.length - 1) addGame();
    else gamesEl.querySelector<HTMLInputElement>(`#g${i + 1}`)?.focus();
  });

  form.addEventListener('change', () => {
    readFields();
    saveDraftLocal(draft);
  });

  root.querySelector('#addGame')!.addEventListener('click', addGame);

  root.querySelector('#resetBtn')?.addEventListener('click', () => {
    clearDraftLocal();
    renderNewSession(root, params);
  });

  root.querySelector('#deleteBtn')?.addEventListener('click', async () => {
    if (!existing) return;
    if (!confirm('Biztosan törlöd ezt az alkalmat? Ez nem vonható vissza.')) return;
    await deleteSession(existing.id);
    toast('Alkalom törölve');
    navigate('#/naplo');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readFields();
    const keep = draft.scores.map((_, i) => i).filter((i) => draft.scores[i].trim() !== '');
    const parsed = keep.map((i) => parseScore(draft.scores[i]));
    if (parsed.some((n) => n === null)) {
      toast('Van hibás pontszám (0–300 közötti egész szám kell).', true);
      return;
    }
    if (parsed.length === 0) {
      toast('Adj meg legalább egy játékot.', true);
      gamesEl.querySelector<HTMLInputElement>('.game-input')?.focus();
      return;
    }
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
    if (!existing) setJustSaved(session.id);
    const scoresSaved = parsed as number[];
    showSaved(existing ? 'Módosítás mentve' : 'Alkalom rögzítve', [
      `${fmtDate(session.date)} · ${typeLabel(session.type)}`,
      `${scoresSaved.length} játék: ${scoresSaved.join(', ')}`,
      `Átlag ${fmtAvg(average(scoresSaved))} · legjobb ${Math.max(...scoresSaved)}`,
    ], 7000, oneAction(getData().sessions, getData().settings.profile));
    navigate(existing ? '#/naplo' : '#/');
  });
}
