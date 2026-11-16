/** Az alkalom típusának azonosítója (a Beállításokban szerkeszthető lista egy eleme). */
export type SessionType = string;

/** Mibe számít a típus: edzésátlagba, versenyátlagba, vagy csak az összátlagba. */
export type TypeKind = 'edzes' | 'verseny' | 'egyeb';

export interface SessionTypeDef {
  id: string;
  label: string;
  kind: TypeKind;
}

export const KIND_LABEL: Record<TypeKind, string> = { edzes: 'Edzés', verseny: 'Verseny', egyeb: 'Egyéb' };

export const DEFAULT_SESSION_TYPES: SessionTypeDef[] = [
  { id: 'edzes', label: 'Edzés', kind: 'edzes' },
  { id: 'bajnoksag', label: 'Bajnokság', kind: 'verseny' },
  { id: 'kupa', label: 'Kupa', kind: 'verseny' },
  { id: 'hivatal_kupa', label: 'Hivatal kupa', kind: 'verseny' },
  { id: 'legerosebb_lancszem', label: 'Legerősebb láncszem', kind: 'verseny' },
  { id: 'egyeb', label: 'Egyéb', kind: 'egyeb' },
];

/**
 * Az aktuális típuslista (a beállításokból; az állapot betöltésekor és mentésekor frissül).
 * Így a statisztika és a felület mindenhol ugyanazt a listát látja.
 */
let registry: SessionTypeDef[] = DEFAULT_SESSION_TYPES;
export const setSessionTypes = (list: SessionTypeDef[] | undefined) => {
  registry = list && list.length ? list : DEFAULT_SESSION_TYPES;
};
export const getSessionTypes = (): SessionTypeDef[] => registry;

export const typeLabel = (t: SessionType): string =>
  registry.find((s) => s.id === t)?.label ?? DEFAULT_SESSION_TYPES.find((s) => s.id === t)?.label ?? t;

/** Ismeretlen (pl. törölt) típus „egyéb”-nek számít. */
export const typeKind = (t: SessionType): TypeKind =>
  registry.find((s) => s.id === t)?.kind ?? DEFAULT_SESSION_TYPES.find((s) => s.id === t)?.kind ?? 'egyeb';

export interface Frame {
  /** Ledöntött bábuk dobásonként (10. frame: 2–3 dobás). */
  rolls: number[];
  /** A spare-kísérlet előtt álló bábuk (1–10). */
  pinsLeft?: number[];
  /** A spare-kísérlet után is álló bábuk. */
  pinsAfter?: number[];
  split?: boolean;
  /** Az első dobás iránya (opcionális): zseb, balra vagy jobbra ment. */
  firstBall?: 'zseb' | 'bal' | 'jobb';
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

/** Bemelegítés az alkalom előtt (minden mező opcionális). */
export interface Warmup {
  /** Bemelegítő dobások száma. */
  shots?: number;
  /** Időtartam percben. */
  minutes?: number;
  /** Szabad szöveges rutin. */
  routine?: string;
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
  warmup?: Warmup;
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
  /** Az alkalmak típusai (szerkeszthető). */
  sessionTypes: SessionTypeDef[];
  /** A mentési emlékeztető elhalasztása eddig az időpontig (ISO). */
  backupSnoozeUntil?: string;
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

/** Az adatmodell aktuális verziója (a migráció ehhez igazít). */
export const CURRENT_SCHEMA = 2 as const;

export interface AppData {
  schemaVersion: typeof CURRENT_SCHEMA;
  sessions: Session[];
  settings: Settings;
  coachReports: CoachReport[];
  /** Már betöltött kezdő adatcsomagok azonosítói (így egy csomag csak egyszer kerül be). */
  appliedSeeds?: string[];
}

export const defaultSettings = (): Settings => ({
  goalAverage: 150,
  balls: ['11 lb', '12 lb', 'Spare golyó'],
  sessionTypes: DEFAULT_SESSION_TYPES.map((t) => ({ ...t })),
  theme: 'auto',
  profile: {},
});

export const emptyData = (): AppData => ({
  schemaVersion: CURRENT_SCHEMA,
  sessions: [],
  settings: defaultSettings(),
  coachReports: [],
});
