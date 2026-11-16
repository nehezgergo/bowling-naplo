/**
 * Kezdő adatok: egyszer kerülnek be (az azonosítójuk az `appliedSeeds` listába íródik),
 * duplikáció nélkül. Ha egy kezdő alkalmat törölsz, nem jön vissza.
 */
import { DEFAULT_SESSION_TYPES, type AppData, type Session } from '../domain/types';
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
  const applied = data.appliedSeeds ?? [];
  if (applied.includes(COLDSTART_SEED)) return { data, added: 0, changed: false };
  const fresh = ROWS.filter((r) => !alreadyThere(r, data.sessions)).map((r) => toSession(r, now));
  // A típusok (Kupa, Hivatal kupa) legyenek a listában, ha közben törölted őket.
  const needed = DEFAULT_SESSION_TYPES.filter((t) => fresh.some((s) => s.type === t.id));
  return {
    data: {
      ...data,
      sessions: [...data.sessions, ...fresh],
      settings: withNewTypes(data.settings, needed),
      appliedSeeds: [...applied, COLDSTART_SEED],
    },
    added: fresh.length,
    changed: true,
  };
}
