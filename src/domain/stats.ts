import { typeKind, type Session, type SessionType } from './types';

export const NO_BALL = 'Nincs megadva';

/** Egy játék a statisztikához, az alkalom adataival együtt. */
export interface GameRef {
  score: number;
  date: string;
  type: SessionType;
  ball: string;
  sessionId: string;
  index: number;
}

/** Minden játék időrendben (dátum, rögzítés ideje, sorszám szerint). */
export function flattenGames(sessions: Session[]): GameRef[] {
  const sorted = [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  const out: GameRef[] = [];
  for (const s of sorted) {
    const games = [...s.games].sort((a, b) => a.index - b.index);
    for (const g of games) {
      out.push({
        score: g.score,
        date: s.date,
        type: s.type,
        ball: g.ball || s.ball || NO_BALL,
        sessionId: s.id,
        index: g.index,
      });
    }
  }
  return out;
}

export function average(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Minden ponthoz az utolsó (legfeljebb) `window` játék átlaga. */
export function movingAverage(scores: number[], window = 20): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < scores.length; i++) {
    sum += scores[i];
    if (i >= window) sum -= scores[i - window];
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}

/** Lineáris regresszió a játékok sorszáma szerint: pont/játék meredekség. */
export function trend(scores: number[]): { slope: number; intercept: number } | null {
  const n = scores.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (scores[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = num / den;
  return { slope, intercept: meanY - slope * meanX };
}

export interface Summary {
  count: number;
  average: number | null;
  best: number | null;
  worst: number | null;
  over150: number;
  over200: number;
  under100: number;
}

export function summarize(scores: number[]): Summary {
  return {
    count: scores.length,
    average: average(scores),
    best: scores.length ? Math.max(...scores) : null,
    worst: scores.length ? Math.min(...scores) : null,
    over150: scores.filter((s) => s >= 150).length,
    over200: scores.filter((s) => s >= 200).length,
    under100: scores.filter((s) => s < 100).length,
  };
}

export interface GroupAvg {
  key: string;
  count: number;
  average: number;
}

export function groupAverages(games: GameRef[], keyOf: (g: GameRef) => string): GroupAvg[] {
  const map = new Map<string, number[]>();
  for (const g of games) {
    const k = keyOf(g);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(g.score);
  }
  return [...map.entries()]
    .map(([key, s]) => ({ key, count: s.length, average: average(s)! }))
    .sort((a, b) => b.count - a.count);
}

export const isCompetition = (t: SessionType) => typeKind(t) === 'verseny';
export const isTraining = (t: SessionType) => typeKind(t) === 'edzes';

export interface Dashboard {
  all: Summary;
  trainingAvg: number | null;
  competitionAvg: number | null;
  /** verseny − edzés (negatív: versenyen gyengébb). */
  competitionMinusTraining: number | null;
  last20Avg: number | null;
  /** Utolsó 20 átlaga az előző 20-hoz képest. */
  last20Change: number | null;
  byType: GroupAvg[];
  byBall: GroupAvg[];
  games: GameRef[];
}

export function dashboard(sessions: Session[]): Dashboard {
  const games = flattenGames(sessions);
  const scores = games.map((g) => g.score);
  const trainingAvg = average(games.filter((g) => isTraining(g.type)).map((g) => g.score));
  const competitionAvg = average(games.filter((g) => isCompetition(g.type)).map((g) => g.score));
  const last20 = scores.slice(-20);
  const prev20 = scores.slice(-40, -20);
  const last20Avg = average(last20);
  const prev20Avg = prev20.length >= 5 ? average(prev20) : null;
  return {
    all: summarize(scores),
    trainingAvg,
    competitionAvg,
    competitionMinusTraining:
      trainingAvg !== null && competitionAvg !== null ? competitionAvg - trainingAvg : null,
    last20Avg,
    last20Change: last20Avg !== null && prev20Avg !== null ? last20Avg - prev20Avg : null,
    byType: groupAverages(games, (g) => g.type),
    byBall: groupAverages(games, (g) => g.ball),
    games,
  };
}

export interface GoalProgress {
  goal: number;
  current: number;
  /** 0–1, a cél felé tett út a jelenlegi (utolsó 20) átlaggal. */
  ratio: number;
  gap: number;
}

export function goalProgress(goal: number | undefined, current: number | null): GoalProgress | null {
  if (!goal || current === null) return null;
  return { goal, current, ratio: Math.max(0, Math.min(1, current / goal)), gap: goal - current };
}

export const sessionAverage = (s: Session) => average(s.games.map((g) => g.score));
