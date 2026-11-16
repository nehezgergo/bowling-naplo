export type SessionType =
  | 'edzes'
  | 'bajnoksag'
  | 'kupa'
  | 'hivatal_kupa'
  | 'legerosebb_lancszem'
  | 'egyeb';

export const SESSION_TYPES: { id: SessionType; label: string }[] = [
  { id: 'edzes', label: 'Edzés' },
  { id: 'bajnoksag', label: 'Bajnokság' },
  { id: 'kupa', label: 'Kupa' },
  { id: 'hivatal_kupa', label: 'Hivatal kupa' },
  { id: 'legerosebb_lancszem', label: 'Legerősebb láncszem' },
  { id: 'egyeb', label: 'Egyéb' },
];

/** Versenynek számító típusok (edzés és egyéb nem). */
export const COMPETITION_TYPES: SessionType[] = ['bajnoksag', 'kupa', 'hivatal_kupa', 'legerosebb_lancszem'];

export const typeLabel = (t: SessionType): string =>
  SESSION_TYPES.find((s) => s.id === t)?.label ?? t;

export interface Frame {
  /** Ledöntött bábuk dobásonként (10. frame: 2–3 dobás). */
  rolls: number[];
  /** A spare-kísérlet előtt álló bábuk (1–10). */
  pinsLeft?: number[];
  /** A spare-kísérlet után is álló bábuk. */
  pinsAfter?: number[];
  split?: boolean;
}

export interface Game {
  index: number;
  score: number;
  /** Ha a játékban más golyó volt, mint az alkalom alapgolyója. */
  ball?: string;
  frames?: Frame[];
}

export type Scale5 = 1 | 2 | 3 | 4 | 5;
export type OilPattern = 'rovid' | 'kozepes' | 'hosszu' | 'ismeretlen';
export type LaneCondition = 'szaraz' | 'normal' | 'olajos';
export type FocusResult = 'igen' | 'reszben' | 'nem';

/** Az edzőnek szóló, alkalmankénti (opcionális) adatok. */
export interface SessionCoach {
  fatigue?: Scale5;
  concentration?: Scale5;
  selfRating?: Scale5;
  oil?: OilPattern;
  laneCondition?: LaneCondition;
  lanes?: string;
  target?: string;
  focusGoal?: string;
  focusResult?: FocusResult;
  wentWell?: string;
  wentBad?: string;
}

export interface Competition {
  ownRank?: number;
  entrants?: number;
  teamName?: string;
  teamRank?: number;
  teamsCount?: number;
}

export interface Session {
  id: string;
  date: string; // YYYY-MM-DD
  type: SessionType;
  eventName?: string;
  venue?: string;
  ball?: string;
  note?: string;
  coach?: SessionCoach;
  competition?: Competition;
  games: Game[];
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  hand?: 'jobb' | 'bal';
  style?: 'egykezes' | 'ketkezes';
  yearsPlaying?: number;
  ballsDescription?: string;
  longTermGoal?: string;
}

export interface Settings {
  goalAverage?: number;
  balls: string[];
  theme: 'auto' | 'light' | 'dark';
  profile: Profile;
  /** Az utolsó export ideje (ISO), a mentési emlékeztetőhöz. */
  lastExportAt?: string;
}

/** A Claude-edző által adott elemzés (kötött szerkezetben). */
export interface CoachAdvice {
  summary: string;
  previousAdviceReview: string;
  strengths: string[];
  focusAreas: { title: string; why: string; how: string }[];
  drills: { name: string; description: string; reps: string }[];
  nextGoal: { metric: string; target: string; why: string };
  encouragement: string;
}

export interface CoachReport {
  id: string;
  createdAt: string;
  model: string;
  question?: string;
  advice: CoachAdvice;
  /** Az elemzéskor ismert utolsó alkalom dátuma és a játékok száma. */
  lastSessionDate: string;
  gamesCount: number;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface AppData {
  schemaVersion: 1;
  sessions: Session[];
  settings: Settings;
  coachReports: CoachReport[];
}

export const defaultSettings = (): Settings => ({
  goalAverage: 150,
  balls: ['11 lb', '12 lb', 'Spare golyó'],
  theme: 'auto',
  profile: {},
});

export const emptyData = (): AppData => ({
  schemaVersion: 1,
  sessions: [],
  settings: defaultSettings(),
  coachReports: [],
});
