/**
 * Export és import: JSON (teljes, pontos mentés) és CSV (Excelhez, illetve a
 * korábbi eredmények betöltéséhez). Tiszta függvények, a felülettől függetlenül tesztelhetők.
 */
import { parseAdvice } from '../coach/prompt';
import { isGameComplete, scoreGame } from '../domain/scoring';
import {
  getSessionTypes,
  typeLabel,
  type AppData,
  type CoachReport,
  type FieldBenchmark,
  type Competition,
  type Frame,
  type Game,
  type Session,
  type SessionCoach,
  type SessionType,
  type SessionTypeDef,
  type Settings,
  type TypeKind,
} from '../domain/types';
import { normalize, validBenchmarks, validTypes } from './db';
import { isBenchmarkCsv, parseBenchmarksCsv } from './fieldIo';

const APP_ID = 'bowling-naplo';

// ───────────────────────── JSON ─────────────────────────

export function exportJson(data: AppData, now = new Date()): string {
  return JSON.stringify(
    { app: APP_ID, schemaVersion: data.schemaVersion, exportedAt: now.toISOString(), sessions: data.sessions, settings: data.settings, coachReports: data.coachReports, appliedSeeds: data.appliedSeeds ?? [], benchmarks: data.benchmarks ?? [] },
    null,
    2,
  );
}

export interface ImportResult {
  sessions: Session[];
  settings?: Settings;
  /** Edzőnapló bejegyzések (csak JSON-ban). */
  coachReports: CoachReport[];
  /** Az importált alkalmakban szereplő, a jelenlegi listában még nem létező típusok. */
  newTypes: SessionTypeDef[];
  /** Mezőny-határok (JSON-ból, vagy mezőny-határ CSV-ből). */
  benchmarks: FieldBenchmark[];
  warnings: string[];
  format: 'json' | 'csv';
}

/** Edzőnapló-bejegyzések: csak a hiánytalanok maradnak meg. */
function cleanReports(raw: unknown, warnings: string[]): CoachReport[] {
  if (!Array.isArray(raw)) return [];
  const out = raw.filter((r): r is CoachReport => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.createdAt !== 'string') return false;
    try {
      parseAdvice(JSON.stringify(r.advice));
      return true;
    } catch {
      return false;
    }
  });
  if (out.length < raw.length) warnings.push(`${raw.length - out.length} edzői elemzés hiányos volt, kihagyva.`);
  return out;
}

/** Edzőnapló összefésülése azonosító szerint. */
export function mergeReports(existing: CoachReport[], incoming: CoachReport[]): CoachReport[] {
  const ids = new Set(existing.map((r) => r.id));
  return [...existing, ...incoming.filter((r) => !ids.has(r.id))];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validFrames(frames: unknown, score: number): Frame[] | undefined {
  if (!Array.isArray(frames)) return undefined;
  const fr = frames as Frame[];
  if (!fr.every((f) => f && Array.isArray(f.rolls))) return undefined;
  if (!isGameComplete(fr) || scoreGame(fr).total !== score) return undefined;
  return fr;
}

/** Egy importált alkalom ellenőrzése; hibás játékokat kihagy, hibás alkalomnál null. */
function cleanSession(raw: unknown, idx: number, warnings: string[], uid: () => string): Session | null {
  const r = raw as Partial<Session> | null;
  const label = `${idx + 1}. alkalom`;
  if (!r || typeof r !== 'object') {
    warnings.push(`${label}: nem értelmezhető, kihagyva.`);
    return null;
  }
  if (!r.date || !ISO_DATE.test(r.date)) {
    warnings.push(`${label}: hibás dátum (${String(r.date)}), kihagyva.`);
    return null;
  }
  const type: SessionType = typeof r.type === 'string' && r.type ? r.type : 'egyeb';
  if (r.type !== type) warnings.push(`${label} (${r.date}): hiányzó típus, „Egyéb” lett.`);
  const games: Game[] = [];
  (Array.isArray(r.games) ? r.games : []).forEach((g, k) => {
    const score = Number(g?.score);
    if (!Number.isInteger(score) || score < 0 || score > 300) {
      warnings.push(`${label} (${r.date}): ${k + 1}. játék hibás pontszám (${String(g?.score)}), kihagyva.`);
      return;
    }
    const game: Game = { index: games.length + 1, score };
    if (g.ball) game.ball = String(g.ball);
    if (g.frames) {
      const fr = validFrames(g.frames, score);
      if (fr) game.frames = fr;
      else warnings.push(`${label} (${r.date}): ${k + 1}. játék frame-adata nem egyezik a pontszámmal, csak a pontszám maradt.`);
    }
    games.push(game);
  });
  if (games.length === 0) {
    warnings.push(`${label} (${r.date}): nincs érvényes játék, kihagyva.`);
    return null;
  }
  const now = new Date().toISOString();
  const s: Session = {
    ...(r as Session),
    id: typeof r.id === 'string' && r.id ? r.id : uid(),
    date: r.date,
    type,
    games,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  };
  return s;
}

export function parseJsonImport(text: string, uid: () => string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('A fájl nem érvényes JSON.');
  }
  const obj = raw as { sessions?: unknown; settings?: unknown; coachReports?: unknown; benchmarks?: unknown };
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.sessions)) throw new Error('A JSON-ban nincs „sessions” lista. Biztos, hogy ebből az appból mentetted?');
  const warnings: string[] = [];
  const sessions = obj.sessions.map((s, i) => cleanSession(s, i, warnings, uid)).filter((s): s is Session => s !== null);
  const settings = obj.settings ? normalize({ sessions: [], settings: obj.settings }).settings : undefined;
  const coachReports = cleanReports(obj.coachReports, warnings);
  const fileTypes = validTypes((obj.settings as { sessionTypes?: unknown } | undefined)?.sessionTypes) ?? [];
  const known = new Set(getSessionTypes().map((t) => t.id));
  const newTypes: SessionTypeDef[] = [];
  for (const s of sessions)
    if (!known.has(s.type)) {
      known.add(s.type);
      newTypes.push(fileTypes.find((t) => t.id === s.type) ?? { id: s.type, label: typeLabel(s.type), kind: guessKind(s.type) });
    }
  return { sessions, settings, coachReports, newTypes, benchmarks: validBenchmarks(obj.benchmarks), warnings, format: 'json' };
}

// ───────────────────────── CSV ─────────────────────────

/** Ékezet- és kisbetű-független kulcs összevetéshez. */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const OIL: Record<string, SessionCoach['oil']> = { rovid: 'rovid', kozepes: 'kozepes', hosszu: 'hosszu', ismeretlen: 'ismeretlen', 'nem tudom': 'ismeretlen' };
const LANE: Record<string, SessionCoach['laneCondition']> = { szaraz: 'szaraz', normal: 'normal', olajos: 'olajos' };
const FOCUS: Record<string, SessionCoach['focusResult']> = { igen: 'igen', reszben: 'reszben', nem: 'nem' };
const OIL_LABEL: Record<string, string> = { rovid: 'rövid', kozepes: 'közepes', hosszu: 'hosszú', ismeretlen: 'nem tudom' };
const LANE_LABEL: Record<string, string> = { szaraz: 'száraz', normal: 'normál', olajos: 'olajos' };
const FOCUS_LABEL: Record<string, string> = { igen: 'igen', reszben: 'részben', nem: 'nem' };

/** CSV oszlopok: [fejléc, elfogadott alternatív nevek]. */
const COLS = {
  date: ['Dátum', 'datum', 'date', 'nap'],
  type: ['Típus', 'tipus', 'type', 'jelleg'],
  eventName: ['Verseny neve', 'verseny', 'esemeny', 'event'],
  venue: ['Helyszín', 'helyszin', 'palya', 'venue', 'hely'],
  ball: ['Golyó', 'golyo', 'ball', 'alkalom golyo'],
  index: ['Játék', 'jatek', 'sorszam', 'jatek sorszam', 'game'],
  score: ['Pontszám', 'pontszam', 'pont', 'eredmeny', 'score', 'pontok'],
  gameBall: ['Játék golyója', 'jatek golyoja', 'jatek golyo'],
  note: ['Megjegyzés', 'megjegyzes', 'note', 'komment'],
  ownRank: ['Saját helyezés', 'sajat helyezes', 'helyezes'],
  entrants: ['Indulók', 'indulok', 'indulok szama'],
  teamName: ['Csapat', 'csapat', 'csapatnev'],
  teamRank: ['Csapat helyezése', 'csapat helyezese'],
  teamsCount: ['Csapatok', 'csapatok', 'csapatok szama'],
  fatigue: ['Fáradtság', 'faradtsag'],
  concentration: ['Koncentráció', 'koncentracio'],
  selfRating: ['Önértékelés', 'onertekeles'],
  oil: ['Olajozás', 'olajozas', 'olaj'],
  laneCondition: ['Pálya állapota', 'palya allapota'],
  lanes: ['Pályaszám', 'palyaszam'],
  target: ['Célpont', 'celpont'],
  focusGoal: ['Fókusz', 'fokusz'],
  focusResult: ['Fókusz sikerült', 'fokusz sikerult'],
  wentWell: ['Mi ment jól', 'mi ment jol'],
  wentBad: ['Mi nem ment', 'mi nem ment'],
  warmupShots: ['Bemelegítő dobások', 'bemelegito dobasok', 'bemelegites dobas'],
  warmupMinutes: ['Bemelegítés (perc)', 'bemelegites perc', 'bemelegites ideje'],
  warmupRoutine: ['Bemelegítő rutin', 'bemelegito rutin', 'bemelegites'],
  id: ['Alkalom azonosító', 'alkalom azonosito', 'alkalom id', 'id'],
} as const;
type ColKey = keyof typeof COLS;

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export: játékonként egy sor, pontosvesszővel, UTF-8 BOM-mal (Excel). */
export function exportCsv(sessions: Session[]): string {
  const keys = Object.keys(COLS) as ColKey[];
  const lines = [keys.map((k) => COLS[k][0]).join(';')];
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const s of sorted) {
    const c = s.coach ?? {};
    const comp = s.competition ?? {};
    for (const g of [...s.games].sort((a, b) => a.index - b.index)) {
      const row: Record<ColKey, unknown> = {
        date: s.date, type: typeLabel(s.type), eventName: s.eventName, venue: s.venue, ball: s.ball,
        index: g.index, score: g.score, gameBall: g.ball, note: s.note,
        ownRank: comp.ownRank, entrants: comp.entrants, teamName: comp.teamName, teamRank: comp.teamRank, teamsCount: comp.teamsCount,
        fatigue: c.fatigue, concentration: c.concentration, selfRating: c.selfRating,
        oil: c.oil && OIL_LABEL[c.oil], laneCondition: c.laneCondition && LANE_LABEL[c.laneCondition],
        lanes: c.lanes, target: c.target, focusGoal: c.focusGoal, focusResult: c.focusResult && FOCUS_LABEL[c.focusResult],
        wentWell: c.wentWell, wentBad: c.wentBad,
        warmupShots: s.warmup?.shots, warmupMinutes: s.warmup?.minutes, warmupRoutine: s.warmup?.routine, id: s.id,
      };
      lines.push(keys.map((k) => csvCell(row[k])).join(';'));
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Minta a korábbi eredmények betöltéséhez. */
export function csvTemplate(): string {
  return (
    '﻿' +
    ['Dátum;Típus;Verseny neve;Helyszín;Golyó;Játék;Pontszám;Megjegyzés',
      '2025-09-12;Edzés;;Gutenberg;12 lb;1;134;',
      '2025-09-12;Edzés;;Gutenberg;12 lb;2;151;',
      '2025-09-20;Bajnokság;Őszi liga 1. forduló;Mammut;12 lb;1;142;jól ment a spare',
      '2025-09-20;Bajnokság;Őszi liga 1. forduló;Mammut;12 lb;2;128;'].join('\r\n') +
    '\r\n'
  );
}

/** CSV sorokra bontása idézőjelek kezelésével; elválasztó automatikusan (; , tab). */
export function parseCsvRows(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Dátum több formátumban: 2025-09-12, 2025.09.12., 2025. 09. 12., 12.09.2025, 2025/9/12, Excel-sorszám. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ok = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})\.?$/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  if (/^\d{5}$/.test(s)) {
    // Excel dátum-sorszám (1900-as rendszer)
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return ok(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return null;
}

/** Típus kategóriája a nevéből (új, importált típusnál). */
export function guessKind(name: string): TypeKind {
  const f = fold(name);
  if (f.startsWith('edz') || f.includes('gyakorl') || f.includes('training')) return 'edzes';
  if (/bajnok|liga|kupa|verseny|torna|lancszem|forduló|fordulo|dontő|donto/.test(f)) return 'verseny';
  return 'egyeb';
}

/**
 * Szöveges típus azonosítása a jelenlegi listában (név vagy azonosító alapján,
 * ékezettől és kisbetűtől függetlenül). Ha nincs találat: null.
 */
export function parseType(v: string, types: SessionTypeDef[] = getSessionTypes()): SessionType | null {
  const f = fold(v);
  if (!f) return null;
  const hit = types.find((t) => fold(t.label) === f || t.id === f.replace(/ /g, '_'));
  if (hit) return hit.id;
  // Az alap típusok szokásos rövidítései, ha a típus még létezik.
  const has = (id: string) => (types.some((t) => t.id === id) ? id : null);
  if (f.startsWith('edz') || f === 'gyakorlas' || f === 'training') return has('edzes');
  if (f === 'liga') return has('bajnoksag');
  return null;
}

/** Új típus létrehozása egy ismeretlen névből (egyedi azonosítóval). */
export function newTypeFromLabel(label: string, existing: SessionTypeDef[]): SessionTypeDef {
  const base = fold(label).replace(/ /g, '_') || 'tipus';
  let id = base;
  for (let i = 2; existing.some((t) => t.id === id); i++) id = `${base}_${i}`;
  return { id, label: label.trim(), kind: guessKind(label) };
}

/** Széles formátum oszlopai: „1. játék”, „jatek2”, „J3”, „game 4”, vagy csak „1”, „2”… */
const WIDE_GAME = /^(?:(\d{1,2})\s*(?:jatek|j|game|g)?|(?:jatek|j|game|g)\s*(\d{1,2}))$/;

export function parseCsvImport(text: string, uid: () => string): ImportResult {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('A CSV-ben nincs adatsor (fejléc + legalább egy sor kell).');
  const header = rows[0].map((h) => fold(h));
  const col: Partial<Record<ColKey, number>> = {};
  for (const k of Object.keys(COLS) as ColKey[]) {
    const names = COLS[k].map(fold);
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  const wideCols = header
    .map((h, i) => {
      const m = h.match(WIDE_GAME);
      return m ? { i, n: Number(m[1] ?? m[2]) } : null;
    })
    .filter((x): x is { i: number; n: number } => x !== null && x.i !== col.index && x.i !== col.score)
    .sort((a, b) => a.n - b.n);

  if (col.date === undefined) throw new Error('Nem találom a dátum oszlopot. A fejlécben legyen „Dátum” oszlop.');
  const wide = col.score === undefined && wideCols.length > 0;
  if (col.score === undefined && !wide) throw new Error('Nem találom a pontszámokat. Kell egy „Pontszám” oszlop, vagy játékonként egy oszlop („1. játék”, „2. játék”…).');

  const warnings: string[] = [];
  const get = (r: string[], k: ColKey) => (col[k] !== undefined ? (r[col[k]!] ?? '').trim() : '');
  const num = (r: string[], k: ColKey) => {
    const v = get(r, k);
    return v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
  };
  const scale = (r: string[], k: ColKey) => {
    const n = num(r, k);
    return n && n >= 1 && n <= 5 && Number.isInteger(n) ? (n as 1 | 2 | 3 | 4 | 5) : undefined;
  };
  const opt = (s: string) => (s === '' ? undefined : s);

  const groups = new Map<string, Session>();
  const newTypes: SessionTypeDef[] = [];
  const order: string[] = [];
  const now = new Date().toISOString();

  rows.slice(1).forEach((r, ri) => {
    const line = ri + 2;
    const date = parseDate(get(r, 'date'));
    if (!date) {
      warnings.push(`${line}. sor: hibás vagy hiányzó dátum („${get(r, 'date')}”), kihagyva.`);
      return;
    }
    const rawType = get(r, 'type');
    let type = parseType(rawType, [...getSessionTypes(), ...newTypes]);
    if (!type) {
      if (rawType) {
        // Ismeretlen típusnév: új típusként felvesszük (a kategóriát a névből becsüljük).
        const def = newTypeFromLabel(rawType, [...getSessionTypes(), ...newTypes]);
        newTypes.push(def);
        type = def.id;
      } else type = (getSessionTypes().find((t) => t.kind === 'edzes') ?? getSessionTypes()[0]).id;
    }
    const eventName = opt(get(r, 'eventName'));
    const venue = opt(get(r, 'venue'));
    const ball = opt(get(r, 'ball'));
    const id = opt(get(r, 'id'));
    const key = id ?? [date, type, eventName ?? '', venue ?? '', ball ?? ''].join('|');

    let s = groups.get(key);
    if (!s) {
      const coach: SessionCoach = {
        fatigue: scale(r, 'fatigue'), concentration: scale(r, 'concentration'), selfRating: scale(r, 'selfRating'),
        oil: OIL[fold(get(r, 'oil'))], laneCondition: LANE[fold(get(r, 'laneCondition'))],
        lanes: opt(get(r, 'lanes')), target: opt(get(r, 'target')), focusGoal: opt(get(r, 'focusGoal')),
        focusResult: FOCUS[fold(get(r, 'focusResult'))], wentWell: opt(get(r, 'wentWell')), wentBad: opt(get(r, 'wentBad')),
      };
      const comp: Competition = {
        ownRank: num(r, 'ownRank'), entrants: num(r, 'entrants'), teamName: opt(get(r, 'teamName')),
        teamRank: num(r, 'teamRank'), teamsCount: num(r, 'teamsCount'),
      };
      s = { id: id ?? uid(), date, type, games: [], createdAt: now, updatedAt: now };
      if (eventName) s.eventName = eventName;
      if (venue) s.venue = venue;
      if (ball) s.ball = ball;
      const note = opt(get(r, 'note'));
      if (note) s.note = note;
      const c = compact(coach);
      if (c) s.coach = c;
      const cp = compact(comp);
      if (cp) s.competition = cp;
      const wu = compact({ shots: num(r, 'warmupShots'), minutes: num(r, 'warmupMinutes'), routine: opt(get(r, 'warmupRoutine')) });
      if (wu) s.warmup = wu;
      groups.set(key, s);
      order.push(key);
    }

    const scores: { v: string; label: string; ball?: string }[] = wide
      ? wideCols.map((w) => ({ v: (r[w.i] ?? '').trim(), label: `${w.n}. játék` }))
      : [{ v: get(r, 'score'), label: 'pontszám', ball: opt(get(r, 'gameBall')) }];
    for (const sc of scores) {
      if (sc.v === '') continue;
      const n = Number(sc.v.replace(',', '.'));
      if (!Number.isInteger(n) || n < 0 || n > 300) {
        warnings.push(`${line}. sor: hibás ${sc.label} („${sc.v}”), kihagyva.`);
        continue;
      }
      // Hosszú formátumban a „Játék” oszlop adja a sorrendet (ha van), különben a sorok sorrendje.
      const idx = !wide ? num(r, 'index') : undefined;
      const g: Game = { index: idx ?? s.games.length + 1, score: n };
      if (sc.ball) g.ball = sc.ball;
      s.games.push(g);
    }
  });

  const sessions = order.map((k) => groups.get(k)!).filter((s) => {
    if (s.games.length === 0) {
      warnings.push(`${s.date}: nincs érvényes pontszám, az alkalom kimaradt.`);
      return false;
    }
    s.games.sort((a, b) => a.index - b.index).forEach((g, i) => (g.index = i + 1));
    return true;
  });
  return { sessions, coachReports: [], newTypes, benchmarks: [], warnings, format: 'csv' };
}

function compact<T extends object>(o: T): T | undefined {
  const e = Object.entries(o).filter(([, v]) => v !== undefined && v !== '');
  return e.length ? (Object.fromEntries(e) as T) : undefined;
}

/** A típuslista kiegészítése az importból jövő új típusokkal (a meglévők változatlanok). */
export function withNewTypes(settings: Settings, newTypes: SessionTypeDef[]): Settings {
  const ids = new Set(settings.sessionTypes.map((t) => t.id));
  const add = newTypes.filter((t) => !ids.has(t.id));
  return add.length ? { ...settings, sessionTypes: [...settings.sessionTypes, ...add] } : settings;
}

export function parseImport(fileName: string, text: string, uid: () => string): ImportResult {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  if (/\.json$/i.test(fileName) || trimmed.startsWith('{')) return parseJsonImport(text, uid);
  if (isBenchmarkCsv(text)) {
    const { benchmarks, warnings } = parseBenchmarksCsv(text, uid);
    return { sessions: [], coachReports: [], newTypes: [], benchmarks, warnings, format: 'csv' };
  }
  return parseCsvImport(text, uid);
}

// ───────────────────────── Összefésülés ─────────────────────────

/** Tartalmi azonosító: azonos napon, azonos típusú, azonos pontszámsor = ugyanaz az alkalom. */
const signature = (s: Session) => `${s.date}|${s.type}|${[...s.games].sort((a, b) => a.index - b.index).map((g) => g.score).join(',')}`;

export interface MergeResult {
  sessions: Session[];
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Összefésülés: azonos azonosítónál a frissebb (`updatedAt`) marad; azonosító
 * nélküli egyezésnél (ugyanaz a nap, típus és pontszámok) kihagyja a duplikátumot.
 */
export function mergeSessions(existing: Session[], incoming: Session[]): MergeResult {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const sigs = new Set(existing.map(signature));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of incoming) {
    const cur = byId.get(s.id);
    if (cur) {
      if (s.updatedAt > cur.updatedAt) {
        byId.set(s.id, s);
        updated++;
      } else skipped++;
      continue;
    }
    const sig = signature(s);
    if (sigs.has(sig)) {
      skipped++;
      continue;
    }
    byId.set(s.id, s);
    sigs.add(sig);
    added++;
  }
  return { sessions: [...byId.values()], added, updated, skipped };
}

export interface ImportSummary {
  sessions: number;
  games: number;
  from?: string;
  to?: string;
  withFrames: number;
}

export function summarizeImport(sessions: Session[]): ImportSummary {
  const dates = sessions.map((s) => s.date).sort();
  return {
    sessions: sessions.length,
    games: sessions.reduce((a, s) => a + s.games.length, 0),
    from: dates[0],
    to: dates.at(-1),
    withFrames: sessions.reduce((a, s) => a + s.games.filter((g) => g.frames).length, 0),
  };
}
