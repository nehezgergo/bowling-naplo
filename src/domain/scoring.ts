/**
 * Frame-szintű pontszámítás és statisztika.
 *
 * Egy frame-ben legfeljebb egy spare-kísérlet van (a 10. frame-ben is): ennek
 * a kiinduló állását (`pinsLeft`) és a kísérlet utáni állást (`pinsAfter`) tároljuk.
 */
import type { Frame, Session } from './types';

export const ALL_PINS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Szomszédos bábuk (sorban, átlósan, és közvetlenül egymás mögött). */
const ADJ: [number, number][] = [
  [7, 8], [8, 9], [9, 10], [4, 5], [5, 6], [2, 3],
  [1, 2], [1, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 7], [4, 8], [5, 8], [5, 9], [6, 9], [6, 10],
  [1, 5], [2, 8], [3, 9],
];

/** Split: a fejbábu (1) ledőlt, és az állva maradt bábuk között rés van. */
export function isSplit(standing: number[]): boolean {
  if (standing.length < 2 || standing.includes(1)) return false;
  const set = new Set(standing);
  const seen = new Set<number>([standing[0]]);
  const stack = [standing[0]];
  while (stack.length) {
    const p = stack.pop()!;
    for (const [a, b] of ADJ) {
      const q = a === p ? b : b === p ? a : null;
      if (q !== null && set.has(q) && !seen.has(q)) {
        seen.add(q);
        stack.push(q);
      }
    }
  }
  return seen.size < set.size;
}

const isInt = (n: number) => Number.isInteger(n) && n >= 0 && n <= 10;

export function isFrameValid(f: Frame, i: number): boolean {
  const r = f.rolls;
  if (!r.every(isInt)) return false;
  const [a, b, c] = r;
  if (i < 9) {
    if (r.length > 2) return false;
    if (a === 10 && r.length > 1) return false;
    if (b !== undefined && a + b > 10) return false;
    return true;
  }
  if (r.length > 3) return false;
  if (b !== undefined && a < 10 && a + b > 10) return false;
  if (c !== undefined) {
    if (a === 10) return b === 10 || b + c <= 10;
    return a + b === 10;
  }
  return true;
}

export function isFrameComplete(f: Frame | undefined, i: number): boolean {
  if (!f) return false;
  const r = f.rolls;
  if (i < 9) return r[0] === 10 || r.length === 2;
  if (r.length < 2) return false;
  return r[0] === 10 || r[0] + r[1] === 10 ? r.length === 3 : r.length === 2;
}

export const isGameComplete = (frames: Frame[]) =>
  frames.length === 10 && frames.every((f, i) => isFrameComplete(f, i) && isFrameValid(f, i));

/**
 * Halmozott pontszám frame-enként. Ahol a frame (vagy a bónuszhoz kellő dobás)
 * még hiányzik, ott `null`; a számolás az első hiányos frame-nél megáll.
 */
export function scoreGame(frames: Frame[]): { total: number; cumulative: (number | null)[] } {
  const cumulative: (number | null)[] = Array(10).fill(null);
  const flat: number[] = [];
  const start: number[] = [];
  for (let i = 0; i < 10; i++) {
    const f = frames[i];
    if (!f || f.rolls.length === 0) break;
    start.push(flat.length);
    flat.push(...f.rolls);
    if (!isFrameComplete(f, i)) break;
  }
  let total = 0;
  for (let i = 0; i < start.length; i++) {
    const f = frames[i];
    if (!isFrameComplete(f, i)) break;
    const k = start[i];
    let v: number | undefined;
    if (i === 9) v = f.rolls.reduce((a, b) => a + b, 0);
    else if (f.rolls[0] === 10) v = flat[k + 1] !== undefined && flat[k + 2] !== undefined ? 10 + flat[k + 1] + flat[k + 2] : undefined;
    else if (f.rolls[0] + f.rolls[1] === 10) v = flat[k + 2] !== undefined ? 10 + flat[k + 2] : undefined;
    else v = f.rolls[0] + f.rolls[1];
    if (v === undefined) break;
    total += v;
    cumulative[i] = total;
  }
  return { total, cumulative };
}

/** Jelölések egy frame dobásaihoz: X, /, - vagy szám. */
export function frameMarks(f: Frame): string[] {
  const out: string[] = [];
  let rack = 10;
  let fresh = true;
  for (const r of f.rolls) {
    if (fresh && r === 10) out.push('X');
    else if (!fresh && r === rack) {
      out.push('/');
      rack = 10;
      fresh = true;
      continue;
    } else {
      out.push(r === 0 ? '-' : String(r));
      if (fresh) {
        rack -= r;
        fresh = false;
      } else {
        rack = 10;
        fresh = true;
      }
      continue;
    }
    rack = 10;
    fresh = true;
  }
  return out;
}

export interface FrameStats {
  games: number;
  frames: number;
  strikes: number;
  strikeChances: number;
  spares: number;
  spareChances: number;
  opens: number;
  /** Ismert állású spare-kísérletek (pin-ábrával rögzítve). */
  leavesKnown: number;
  splits: number;
  splitsConverted: number;
  singlePinChances: number;
  singlePinSpares: number;
  cornerLeaves: number;
  cornerSpares: number;
  /** Állás → kísérletek / sikeres. Kulcs: pl. "3-6-10". */
  leaves: Map<string, { n: number; made: number }>;
}

export const leaveKey = (pins: number[]) => [...pins].sort((a, b) => a - b).join('-');

export function emptyFrameStats(): FrameStats {
  return {
    games: 0, frames: 0, strikes: 0, strikeChances: 0, spares: 0, spareChances: 0, opens: 0,
    leavesKnown: 0, splits: 0, splitsConverted: 0, singlePinChances: 0, singlePinSpares: 0,
    cornerLeaves: 0, cornerSpares: 0, leaves: new Map(),
  };
}

/** Egy (teljes) játék frame-statisztikája hozzáadva `acc`-hoz. `corner`: 10 jobbkezesnek, 7 balkezesnek. */
export function addGameStats(acc: FrameStats, frames: Frame[], corner = 10): FrameStats {
  if (!isGameComplete(frames)) return acc;
  acc.games++;
  frames.forEach((f) => {
    acc.frames++;
    let rack = 10;
    let fresh = true;
    let hadMark = false;
    f.rolls.forEach((r, k) => {
      // Az 1–9. frame-ben csak az első dobás „friss”; a 10.-ben minden új állás az.
      if (fresh) {
        acc.strikeChances++;
        if (r === 10) {
          acc.strikes++;
          if (k === 0) hadMark = true;
          rack = 10;
          return;
        }
        rack -= r;
        fresh = false;
      } else {
        acc.spareChances++;
        const made = r === rack;
        if (made) {
          acc.spares++;
          if (k === 1) hadMark = true;
        }
        const leave = f.pinsLeft;
        // Csak akkor használjuk, ha az ábra egyezik a dobás számával.
        if (leave && leave.length === rack) {
          acc.leavesKnown++;
          const split = f.split ?? isSplit(leave);
          if (split) {
            acc.splits++;
            if (made) acc.splitsConverted++;
          }
          if (leave.length === 1) {
            acc.singlePinChances++;
            if (made) acc.singlePinSpares++;
            if (leave[0] === corner) {
              acc.cornerLeaves++;
              if (made) acc.cornerSpares++;
            }
          }
          const key = leaveKey(leave);
          const e = acc.leaves.get(key) ?? { n: 0, made: 0 };
          e.n++;
          if (made) e.made++;
          acc.leaves.set(key, e);
        }
        rack = 10;
        fresh = true;
      }
    });
    if (!hadMark) acc.opens++;
  });
  return acc;
}

export function sessionFrameStats(sessions: Session[], corner = 10): FrameStats {
  const acc = emptyFrameStats();
  for (const s of sessions) for (const g of s.games) if (g.frames) addGameStats(acc, g.frames, corner);
  return acc;
}

export const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/** A leggyakrabban elhibázott állások (legalább `minN` kísérlettel). */
export function worstLeaves(st: FrameStats, minN = 2, limit = 3) {
  return [...st.leaves.entries()]
    .map(([key, v]) => ({ key, ...v, missed: v.n - v.made }))
    .filter((x) => x.n >= minN && x.missed > 0)
    .sort((a, b) => b.missed - a.missed || a.made / a.n - b.made / b.n)
    .slice(0, limit);
}
