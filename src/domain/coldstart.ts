/**
 * Hidegindítás-figyelő: az 1. játék és a későbbi játékok összevetése,
 * valamint az 1. játék a bemelegítés függvényében.
 */
import { average } from './stats';
import { typeKind, type Session } from './types';

/** Ennyi alkalom alatt nem vonunk le következtetést. */
export const MIN_SAMPLE = 5;

export type KindFilter = 'verseny' | 'edzes' | 'mind';

const sorted = (s: Session) => [...s.games].sort((a, b) => a.index - b.index);
const matches = (s: Session, f: KindFilter) => f === 'mind' || typeKind(s.type) === f;

export interface ColdStart {
  /** Hány (legalább kétjátékos) alkalomból számol. */
  n: number;
  firstAvg: number | null;
  secondAvg: number | null;
  /** A 2. és későbbi játékok átlaga (edzésen gyakran 3+ játék van). */
  laterAvg: number | null;
  /** later − first: pozitív, ha az 1. játék a gyengébb. */
  diff: number | null;
  /** Hányszor volt a 2. játék jobb, mint az 1. */
  secondBetter: number;
  /** Hányszor volt egyenlő. */
  ties: number;
  /** Elég-e az adat a következtetéshez. */
  enough: boolean;
}

export function coldStart(sessions: Session[], filter: KindFilter = 'mind'): ColdStart {
  const multi = sessions.filter((s) => s.games.length >= 2 && matches(s, filter));
  const firsts = multi.map((s) => sorted(s)[0].score);
  const seconds = multi.map((s) => sorted(s)[1].score);
  const later = multi.flatMap((s) => sorted(s).slice(1).map((g) => g.score));
  const firstAvg = average(firsts);
  const laterAvg = average(later);
  return {
    n: multi.length,
    firstAvg,
    secondAvg: average(seconds),
    laterAvg,
    diff: firstAvg !== null && laterAvg !== null ? laterAvg - firstAvg : null,
    secondBetter: multi.filter((s) => sorted(s)[1].score > sorted(s)[0].score).length,
    ties: multi.filter((s) => sorted(s)[1].score === sorted(s)[0].score).length,
    enough: multi.length >= MIN_SAMPLE,
  };
}

export interface WarmupBucket {
  key: string;
  label: string;
  n: number;
  /** Az 1. játék átlaga; null, ha kevés az adat (n < 5). */
  firstAvg: number | null;
  /** Nyers átlag kis mintánál is (csak tájékoztató, „kevés adat” jelzéssel). */
  rawAvg: number | null;
}

const BUCKETS = [
  { key: '0-5', label: '0–5 dobás', min: 0, max: 5 },
  { key: '6-10', label: '6–10 dobás', min: 6, max: 10 },
  { key: '11+', label: '11+ dobás', min: 11, max: Infinity },
];

const bucketOf = (shots: number) => BUCKETS.find((b) => shots >= b.min && shots <= b.max)!;

/** Az 1. játék átlaga a bemelegítő dobások száma szerint. */
export function warmupBuckets(sessions: Session[], filter: KindFilter = 'mind'): WarmupBucket[] {
  const withShots = sessions.filter((s) => s.games.length >= 1 && matches(s, filter) && typeof s.warmup?.shots === 'number');
  return BUCKETS.map((b) => {
    const firsts = withShots.filter((s) => bucketOf(s.warmup!.shots!).key === b.key).map((s) => sorted(s)[0].score);
    const rawAvg = average(firsts);
    return { key: b.key, label: b.label, n: firsts.length, rawAvg, firstAvg: firsts.length >= MIN_SAMPLE ? rawAvg : null };
  });
}

export interface BestRoutine {
  bucket: WarmupBucket;
  /** A legjobb 1. játékot hozó rutin leírása ebből a csoportból (ha van szöveges rutin). */
  routine?: string;
  routineDate?: string;
  routineFirst?: number;
  avgMinutes: number | null;
}

/**
 * Az eddig legjobban működő bemelegítés: a legmagasabb 1. játék átlagú csoport,
 * de csak legalább 5 alkalom alapján. Ha egyik csoport sem éri el, null.
 */
export function bestWarmup(sessions: Session[], filter: KindFilter = 'mind'): BestRoutine | null {
  const buckets = warmupBuckets(sessions, filter).filter((b) => b.firstAvg !== null);
  if (buckets.length === 0) return null;
  const best = buckets.reduce((a, b) => (b.firstAvg! > a.firstAvg! ? b : a));
  const inBucket = sessions.filter(
    (s) => matches(s, filter) && s.games.length >= 1 && typeof s.warmup?.shots === 'number' && bucketOf(s.warmup.shots).key === best.key,
  );
  const withRoutine = inBucket.filter((s) => s.warmup?.routine?.trim());
  const top = withRoutine.sort((a, b) => sorted(b)[0].score - sorted(a)[0].score || b.date.localeCompare(a.date))[0];
  const minutes = inBucket.map((s) => s.warmup?.minutes).filter((m): m is number => typeof m === 'number');
  return {
    bucket: best,
    routine: top?.warmup?.routine?.trim(),
    routineDate: top?.date,
    routineFirst: top ? sorted(top)[0].score : undefined,
    avgMinutes: average(minutes),
  };
}

/** Hány alkalomnál van bemelegítés rögzítve (dobásszám). */
export const warmupCount = (sessions: Session[], filter: KindFilter = 'mind') =>
  sessions.filter((s) => matches(s, filter) && typeof s.warmup?.shots === 'number').length;
