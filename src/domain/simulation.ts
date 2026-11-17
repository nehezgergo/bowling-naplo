/**
 * Mezőnymodell: kétjátékos verseny szimulációja a saját játékaidból (bootstrap),
 * élő célszám, és a zajjelző (szokásos sáv vagy valódi kiugrás).
 * Minden helyben fut; a véletlenszám-generátor seedelhető (tesztek, stabil kijelzés).
 */
import type { FieldBenchmark, Session, SimSettings } from './types';
import { average, flattenGames } from './stats';
import { typeKind } from './types';
import { stdDev } from '../coach/rules';

/** Seedelhető, gyors véletlenszám-generátor (mulberry32): [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pools {
  /** A mintavételhez használt játékok (a legutóbbi N, szűrve). */
  all: number[];
  /** Ezek közül az alkalmak 1. játékai. */
  first: number[];
  /** Ezek közül a 2. és későbbi játékok. */
  later: number[];
}

/** A legutóbbi N játék (szűrve) 1. játékokra és későbbiekre bontva. */
export function buildPools(sessions: Session[], sim: Pick<SimSettings, 'games' | 'filter'>): Pools {
  const games = flattenGames(sessions).filter((g) => sim.filter === 'mind' || typeKind(g.type) === sim.filter);
  const recent = games.slice(-Math.max(1, sim.games));
  return {
    all: recent.map((g) => g.score),
    first: recent.filter((g) => g.index === 1).map((g) => g.score),
    later: recent.filter((g) => g.index >= 2).map((g) => g.score),
  };
}

/** Legalább ennyi kell mindkét csoportba a külön mintázáshoz. */
export const MIN_SPLIT = 5;

export interface SimResult {
  runs: number;
  /** Hány játékból mintázott, és hogyan. */
  n: number;
  mode: 'kulon' | 'kozos';
  nFirst: number;
  nLater: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** Az egyes határok elérésének valószínűsége (0–1). */
  chance: (cutoff: number) => number;
}

/**
 * 10 000 kétjátékos verseny: az 1. játék az 1. játékaidból, a 2. a későbbiekből
 * (ha mindkettőből van legalább 5 és be van kapcsolva), különben egy közös mintából.
 */
export function simulateTwoGames(pools: Pools, opts: { runs?: number; seed?: number; splitFirst?: boolean } = {}): SimResult | null {
  const runs = opts.runs ?? 10_000;
  if (pools.all.length === 0) return null;
  const split = (opts.splitFirst ?? true) && pools.first.length >= MIN_SPLIT && pools.later.length >= MIN_SPLIT;
  const p1 = split ? pools.first : pools.all;
  const p2 = split ? pools.later : pools.all;
  const rnd = mulberry32(opts.seed ?? 20261117);
  const totals = new Int32Array(runs);
  for (let i = 0; i < runs; i++) totals[i] = p1[Math.floor(rnd() * p1.length)] + p2[Math.floor(rnd() * p2.length)];
  totals.sort();
  const q = (p: number) => totals[Math.min(runs - 1, Math.floor(p * (runs - 1)))];
  let sum = 0;
  for (let i = 0; i < runs; i++) sum += totals[i];
  return {
    runs,
    n: pools.all.length,
    mode: split ? 'kulon' : 'kozos',
    nFirst: pools.first.length,
    nLater: pools.later.length,
    mean: sum / runs,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    chance: (cutoff: number) => {
      // Rendezett tömbben: az első index, ahol az összeg ≥ határ.
      let lo = 0;
      let hi = runs;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (totals[mid] < cutoff) lo = mid + 1;
        else hi = mid;
      }
      return (runs - lo) / runs;
    },
  };
}

/** Az utolsó (legfeljebb) 3 verseny továbbjutó helyéhez tartozó összeg átlaga. */
export function defaultCutoff(benchmarks: FieldBenchmark[], category: 'egyeni' | 'csapat' = 'egyeni', series?: string): number | null {
  const list = benchmarks
    .filter((b) => b.category === category && (!series || b.series === series))
    .filter((b) => b.cutoffs.some((c) => c.rank === b.qualifyRank))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(-3);
  if (list.length === 0) return null;
  return Math.round(average(list.map((b) => b.cutoffs.find((c) => c.rank === b.qualifyRank)!.total))!);
}

/** Helyezésenkénti átlagos határ az utolsó 3 versenyből (csak a mindháromban szereplő helyekre). */
export function averageCutoffs(benchmarks: FieldBenchmark[], category: 'egyeni' | 'csapat' = 'egyeni'): { rank: number; total: number }[] {
  const list = benchmarks.filter((b) => b.category === category).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).slice(-3);
  if (list.length === 0) return [];
  const ranks = list[0].cutoffs.map((c) => c.rank).filter((r) => list.every((b) => b.cutoffs.some((c) => c.rank === r)));
  return ranks.map((rank) => ({ rank, total: Math.round(average(list.map((b) => b.cutoffs.find((c) => c.rank === rank)!.total))!) }));
}

export interface LiveTarget {
  /** Ennyi kell a 2. játékban a határhoz. */
  need: number;
  /** Elérhetetlen (300 fölött) vagy már megvan (≤ 0). */
  status: 'kell' | 'megvan' | 'lehetetlen';
  /** A 2. játékaid közül hányszor dobtál legalább ennyit. */
  hits: number;
  n: number;
}

/** Élő célszám: az 1. játék után mennyi kell a 2.-ban, és ez milyen gyakori nálad. */
export function liveTarget(first: number, cutoff: number, secondPool: number[]): LiveTarget {
  const need = cutoff - first;
  if (need <= 0) return { need, status: 'megvan', hits: secondPool.length, n: secondPool.length };
  if (need > 300) return { need, status: 'lehetetlen', hits: 0, n: secondPool.length };
  return { need, status: 'kell', hits: secondPool.filter((s) => s >= need).length, n: secondPool.length };
}

export interface Noise {
  /** Hány korábbi játék alapján. */
  n: number;
  expected: number;
  /** Az eredmény eltérése szórásegységben. */
  z: number;
  verdict: 'savon-belul' | 'kiugro-jo' | 'kiugro-gyenge' | 'keves';
}

/** Ennyi korábbi játék kell a zajjelzőhöz. */
export const MIN_NOISE = 10;

/**
 * Zajjelző: egy `games` játékos összeredmény a verseny előtti játékaidhoz mérve.
 * A várható sáv: átlag × játékszám ± 1 szórás (a szórás √játékszám-mal nő).
 */
export function noiseFor(sessions: Session[], date: string, total: number, games = 2, excludeId?: string): Noise {
  const prior = flattenGames(sessions.filter((s) => s.id !== excludeId)).filter((g) => g.date < date).map((g) => g.score).slice(-60);
  const m = average(prior);
  const sd = stdDev(prior);
  if (prior.length < MIN_NOISE || m === null || sd === null || sd === 0) return { n: prior.length, expected: (m ?? 0) * games, z: 0, verdict: 'keves' };
  const expected = m * games;
  const z = (total - expected) / (sd * Math.sqrt(games));
  return { n: prior.length, expected, z, verdict: z > 1 ? 'kiugro-jo' : z < -1 ? 'kiugro-gyenge' : 'savon-belul' };
}

/** Esély kiírása a mintaszámhoz mérten: kis mintánál nem mutat magabiztos százalékot. */
export function chanceText(p: number, n: number): { text: string; sure: boolean } {
  if (n < 10) return { text: 'kevés adat', sure: false };
  const pct = Math.round(p * 100);
  if (n < 20) return { text: `~${Math.round(pct / 5) * 5}% (bizonytalan)`, sure: false };
  return { text: `${pct}%`, sure: true };
}
