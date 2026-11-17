/**
 * Kezdő adatok: egyszer kerülnek be (az azonosítójuk az `appliedSeeds` listába íródik),
 * duplikáció nélkül. Ha egy kezdő alkalmat törölsz, nem jön vissza.
 */
import { DEFAULT_SESSION_TYPES, type AppData, type FieldBenchmark, type Session } from '../domain/types';
import { fold, withNewTypes } from './io';

export const COLDSTART_SEED = 'versenyek-2025-2026-v1';

interface SeedRow {
  id: string;
  date: string;
  /** A pontos nap nem ismert (a hónap 15-ére tettük). */
  approxDate?: boolean;
  type: 'kupa' | 'hivatal_kupa';
  eventName: string;
  games: [number, number];
  ownRank?: number;
  entrants?: number;
}

const ROWS: SeedRow[] = [
  { id: 'seed-teli-kupa-2025', date: '2025-02-24', type: 'kupa', eventName: 'Téli Kupa', games: [137, 158] },
  { id: 'seed-marciusi-kupa-2025', date: '2025-03-15', approxDate: true, type: 'kupa', eventName: 'Márciusi Kupa', games: [102, 135] },
  { id: 'seed-hivatal-xxii', date: '2025-04-15', approxDate: true, type: 'hivatal_kupa', eventName: 'XXII. Hivatal Kupa', games: [120, 114], ownRank: 33, entrants: 58 },
  { id: 'seed-nyari-kupa-2025', date: '2025-08-05', type: 'kupa', eventName: 'Nyári Kupa', games: [113, 159] },
  { id: 'seed-hivatal-xxiii', date: '2025-11-15', approxDate: true, type: 'hivatal_kupa', eventName: 'XXIII. Hivatal Kupa', games: [117, 137], ownRank: 18, entrants: 81 },
  { id: 'seed-hivatal-xxiv', date: '2026-04-15', approxDate: true, type: 'hivatal_kupa', eventName: 'XXIV. Hivatal Kupa', games: [132, 135], ownRank: 12, entrants: 84 },
  { id: 'seed-hivatal-xxv', date: '2026-11-15', approxDate: true, type: 'hivatal_kupa', eventName: 'XXV. Hivatal Kupa', games: [177, 147], ownRank: 4, entrants: 93 },
];

/** Kezdő adatból jött-e az alkalom. */
export const isSeed = (s: Session) => s.id.startsWith('seed-');

/**
 * A legutóbb általad rögzített alkalom (az új alkalom alapértékeihez).
 * A kezdő adatok nem számítanak, ha van saját bejegyzés.
 */
export function latestEntered(sessions: Session[]): Session | undefined {
  const byCreated = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return byCreated.find((s) => !isSeed(s)) ?? byCreated[0];
}

const scoresKey = (s: Session) => [...s.games].sort((a, b) => a.index - b.index).map((g) => g.score).join(',');

/** Ugyanaz az alkalom: azonos azonosító, vagy azonos hónap és pontszámsor, vagy azonos versenynév és pontszámsor. */
function alreadyThere(row: SeedRow, sessions: Session[]): boolean {
  const key = row.games.join(',');
  return sessions.some(
    (s) =>
      s.id === row.id ||
      (scoresKey(s) === key && (s.date.slice(0, 7) === row.date.slice(0, 7) || (!!s.eventName && fold(s.eventName) === fold(row.eventName)))),
  );
}

function toSession(row: SeedRow, now: string): Session {
  const s: Session = {
    id: row.id,
    date: row.date,
    type: row.type,
    eventName: row.eventName,
    games: row.games.map((score, i) => ({ index: i + 1, score })),
    note: row.approxDate ? 'Kezdő adat; a pontos dátum pontosítandó.' : 'Kezdő adat.',
    // A létrehozás ideje a verseny napja, így nem lesz „a legutóbb rögzített alkalom”
    // (az adja az új alkalom alapértelmezéseit); a módosítás ideje a betöltés, így a mentési emlékeztető számol vele.
    createdAt: `${row.date}T12:00:00.000Z`,
    updatedAt: now,
  };
  if (row.ownRank || row.entrants) s.competition = { ownRank: row.ownRank, entrants: row.entrants };
  return s;
}

export interface SeedResult {
  data: AppData;
  added: number;
  changed: boolean;
}

/** A kezdő adatok betöltése, ha még nem történt meg. Tiszta függvény: új objektumot ad vissza. */
export function applySeeds(data: AppData, now = new Date().toISOString()): SeedResult {
  let out = data;
  let added = 0;
  let changed = false;
  const applied = () => out.appliedSeeds ?? [];

  if (!applied().includes(COLDSTART_SEED)) {
    const fresh = ROWS.filter((r) => !alreadyThere(r, out.sessions)).map((r) => toSession(r, now));
    // A típusok (Kupa, Hivatal kupa) legyenek a listában, ha közben törölted őket.
    const needed = DEFAULT_SESSION_TYPES.filter((t) => fresh.some((x) => x.type === t.id));
    out = { ...out, sessions: [...out.sessions, ...fresh], settings: withNewTypes(out.settings, needed), appliedSeeds: [...applied(), COLDSTART_SEED] };
    added += fresh.length;
    changed = true;
  }

  if (!applied().includes(FIELD_SEED)) {
    const existing = out.benchmarks ?? [];
    const fresh = FIELD_ROWS.filter((b) => !existing.some((e) => e.id === b.id || (e.category === b.category && fold(e.event) === fold(b.event))));
    out = { ...out, benchmarks: [...existing, ...fresh], appliedSeeds: [...applied(), FIELD_SEED] };
    changed = true;
  }

  return { data: out, added, changed };
}

// ───────────────── Hivatal Kupa mezőny-határok (2 játék összege a selejtezőben) ─────────────────

export const FIELD_SEED = 'mezony-hivatal-kupa-v1';

const ind = (id: string, event: string, date: string, entrants: number, c: [number, number, number, number], own: [number, number]): FieldBenchmark => ({
  id, series: 'Hivatal Kupa', event, date, category: 'egyeni', entrants, qualifyRank: 12,
  cutoffs: [{ rank: 1, total: c[0] }, { rank: 3, total: c[1] }, { rank: 12, total: c[2] }, { rank: 13, total: c[3] }],
  own: { total: own[0], rank: own[1] },
});
const team = (id: string, event: string, date: string, entrants: number, c: [number, number, number, number], own: [number, number]): FieldBenchmark => ({
  id, series: 'Hivatal Kupa', event, date, category: 'csapat', entrants, qualifyRank: 16,
  cutoffs: [{ rank: 8, total: c[0] }, { rank: 12, total: c[1] }, { rank: 16, total: c[2] }, { rank: 17, total: c[3] }],
  own: { total: own[0], rank: own[1] },
});

export const FIELD_ROWS: FieldBenchmark[] = [
  ind('hk-xxii-egyeni', 'XXII (2025 tavasz)', '2025-04-15', 58, [380, 326, 281, 279], [234, 33]),
  ind('hk-xxiii-egyeni', 'XXIII (2025 ősz)', '2025-11-15', 81, [379, 345, 273, 264], [254, 18]),
  ind('hk-xxiv-egyeni', 'XXIV (2026 tavasz)', '2026-04-15', 84, [366, 325, 267, 264], [267, 12]),
  ind('hk-xxv-egyeni', 'XXV (2026 ősz)', '2026-11-15', 93, [409, 332, 297, 292], [324, 4]),
  team('hk-xxii-csapat', 'XXII (2025 tavasz)', '2025-04-15', 24, [1258, 1095, 1003, 989], [1091, 13]),
  team('hk-xxiii-csapat', 'XXIII (2025 ősz)', '2025-11-15', 33, [1250, 1073, 1018, 1016], [1059, 14]),
  team('hk-xxiv-csapat', 'XXIV (2026 tavasz)', '2026-04-15', 31, [1209, 1018, 1000, 996], [1059, 11]),
  team('hk-xxv-csapat', 'XXV (2026 ősz)', '2026-11-15', 35, [1321, 1128, 1023, 995], [1212, 10]),
];
