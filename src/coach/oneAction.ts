/**
 * „Egy teendő” edző: egyetlen mondat arról, mit gyakorolj legközelebb.
 * Szabályalapú, helyben fut. Minden jelöltre becsült pinveszteséget számol
 * (pin / játék), és a legnagyobb nyer; egyenlőségnél a felsorolás sorrendje dönt.
 */
import { bestWarmup, coldStart, MIN_SAMPLE } from '../domain/coldstart';
import { addGameStats, emptyFrameStats, leaveTable, scoreGame, type FrameStats } from '../domain/scoring';
import { average, isCompetition, isTraining } from '../domain/stats';
import type { Frame, Profile, Session } from '../domain/types';
import { fmtAvg, times } from '../util/format';

export type ActionId = 'hidegindulas' | 'spare' | 'iranyzes' | 'verseny' | 'adat';

export interface OneAction {
  id: ActionId;
  /** Egyetlen mondat: mit gyakorolj. */
  text: string;
  /** Milyen adatból jött (ellenőrizhető). */
  source: string;
  /** Becsült pinveszteség játékonként (adathiány esetén null). */
  lossPerGame: number | null;
}

/** Ennyi legutóbbi frame-adatos játékot nézünk. */
export const RECENT_FRAME_GAMES = 20;
/** Hidegindítás: legalább ennyi pin hátrány kell. */
export const COLD_MIN_DIFF = 8;
/** Irányhiba: a tévesztések legalább ekkora része menjen egy irányba, legalább ennyi tévesztésből. */
export const DIR_SHARE = 0.6;
export const DIR_MIN_MISSES = 8;
/** Edzés–verseny: legalább ennyi pin különbség, mindkét oldalon legalább ennyi játékból. */
export const GAP_MIN = 5;
export const GAP_MIN_GAMES = 6;

const r1 = (n: number) => fmtAvg(n);

function sortedSessions(sessions: Session[]) {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** A legutóbbi N frame-adatos (teljes) játék. */
export function recentFrameGames(sessions: Session[], n = RECENT_FRAME_GAMES): Frame[][] {
  const out: Frame[][] = [];
  for (const s of sortedSessions(sessions))
    for (const g of [...s.games].sort((a, b) => a.index - b.index)) if (g.frames && g.frames.length === 10) out.push(g.frames);
  return out.slice(-n);
}

function frameStatsOf(games: Frame[][], corner: number): FrameStats {
  const st = emptyFrameStats();
  for (const g of games) addGameStats(st, g, corner);
  return st;
}

const leaveName = (key: string) => (key.includes('-') ? `${key} állás` : `${key}-es bábu`);

/** Rövid, konkrét gyakorlat az álláshoz (a kezességhez igazítva). */
function leaveAdvice(key: string, split: boolean, hand: Profile['hand']): string {
  const pins = key.split('-').map(Number);
  const corner = hand === 'bal' ? 7 : 10;
  const otherCorner = hand === 'bal' ? 10 : 7;
  if (pins.length === 1 && pins[0] === corner)
    return `gyakorold a ${corner}-es bábut: a pálya ${corner === 10 ? 'bal' : 'jobb'} széléről, keresztben, egyenes dobással`;
  if (pins.length === 1 && pins[0] === otherCorner)
    return `gyakorold a ${otherCorner}-es bábut: a pálya ${otherCorner === 10 ? 'bal' : 'jobb'} széléről, keresztben, egyenesen`;
  if (pins.length === 1) return `gyakorold a ${pins[0]}-es bábut: ugyanarra a nyílra nézz, mint máskor, csak állj kicsit arrébb`;
  if (split) return `a ${key} splitnél (amikor rés van a bábuk közt) ne kockáztass, üsd le biztosan az egyik bábut`;
  return `gyakorold a ${key} állást: célozz a legelöl álló bábura, egyenes, nyugodt dobással`;
}

/** Átlagos frame-pont (1–9. frame) a jelölt első dobás szerint; a jelöletlen strike zsebnek számít. */
function frameValueByDir(games: Frame[][]) {
  const vals: Record<'zseb' | 'bal' | 'jobb', number[]> = { zseb: [], bal: [], jobb: [] };
  for (const frames of games) {
    const cum = scoreGame(frames).cumulative;
    for (let i = 0; i < 9; i++) {
      const f = frames[i];
      const prev = i === 0 ? 0 : cum[i - 1];
      if (cum[i] === null || prev === null) continue;
      const dir = f.firstBall ?? (f.rolls[0] === 10 ? 'zseb' : undefined);
      if (dir) vals[dir].push(cum[i]! - prev);
    }
  }
  return vals;
}

export function oneAction(sessions: Session[], profile: Profile = {}): OneAction {
  const candidates: OneAction[] = [];
  const corner = profile.hand === 'bal' ? 7 : 10;

  // 1) Hidegindítás (versenyen, ha ott van elég alkalom; különben minden alkalomból).
  const csComp = coldStart(sessions, 'verseny');
  const cs = csComp.n >= MIN_SAMPLE ? csComp : coldStart(sessions, 'mind');
  const csLabel = cs === csComp ? 'verseny' : 'alkalom';
  if (cs.n >= MIN_SAMPLE && cs.diff !== null && cs.firstAvg !== null && cs.laterAvg !== null && cs.diff >= COLD_MIN_DIFF) {
    const multi = sessions.filter((s) => s.games.length >= 2 && (cs === csComp ? isCompetition(s.type) : true));
    const gamesPer = average(multi.map((s) => s.games.length)) ?? 2;
    const best = bestWarmup(sessions, 'verseny') ?? bestWarmup(sessions, 'mind');
    candidates.push({
      id: 'hidegindulas',
      text: best
        ? `Melegíts be úgy, ahogy eddig bevált (${best.bucket.label}${best.routine ? `: ${best.routine}` : ''}), mert az 1. játékod átlagosan ${Math.round(cs.diff)} ponttal gyengébb a későbbieknél.`
        : `Melegíts be alaposabban: verseny előtt dobj legalább 8–10 próbadobást úgy, mintha már játszanál, mert az 1. játékod átlagosan ${Math.round(cs.diff)} ponttal gyengébb a későbbieknél.`,
      source: `1. játék ${r1(cs.firstAvg)}, később ${r1(cs.laterAvg)} (${cs.n} ${csLabel}, ebből ${times(cs.secondBetter)} jobb a 2.)`,
      lossPerGame: cs.diff / gamesPer,
    });
  }

  // 2) A legtöbb pinbe kerülő kihagyott spare-állás (az utolsó 20 frame-adatos játékból).
  const fg = recentFrameGames(sessions);
  const st = frameStatsOf(fg, corner);
  if (st.games > 0) {
    const worst = leaveTable(st).find((r) => r.worst);
    if (worst && worst.missed >= 2) {
      candidates.push({
        id: 'spare',
        text: `${leaveAdvice(worst.key, worst.split, profile.hand).replace(/^./, (c) => c.toUpperCase())}.`,
        source: `${leaveName(worst.key)}: ${worst.made}/${worst.n} az utolsó ${st.games} játékban (kb. ${r1(worst.lostPins / st.games)} pont játékonként)`,
        lossPerGame: worst.lostPins / st.games,
      });
    }

    // 3) Az első dobás szisztematikus oldalra húzása.
    const misses = st.dir.bal + st.dir.jobb;
    const side = st.dir.jobb >= st.dir.bal ? 'jobb' : 'bal';
    const sideCount = st.dir[side];
    if (misses >= DIR_MIN_MISSES && sideCount / misses >= DIR_SHARE) {
      const v = frameValueByDir(fg);
      const pocket = average(v.zseb);
      const miss = average(v[side]);
      const perFrameLoss = pocket !== null && miss !== null ? Math.max(0, pocket - miss) : 0;
      const sideWord = side === 'jobb' ? 'jobbra' : 'balra';
      candidates.push({
        id: 'iranyzes',
        text: `Az első dobásod rendszeresen ${sideWord} megy: célozz ugyanoda, de indulj kb. 5 cm-rel (2 deszkacsíkkal) ${sideWord}.`,
        source: `első dobás: ${misses} tévesztésből ${sideCount} ${sideWord} az utolsó ${st.games} játékban${pocket !== null && miss !== null ? ` (jó iránynál ${r1(pocket)}, ${sideWord} tévesztve ${r1(miss)} pont körönként)` : ''}`,
        lossPerGame: (sideCount / st.games) * perFrameLoss,
      });
    }
  }

  // 4) Edzés–verseny különbség.
  const tr = sessions.filter((s) => isTraining(s.type)).flatMap((s) => s.games.map((g) => g.score));
  const co = sessions.filter((s) => isCompetition(s.type)).flatMap((s) => s.games.map((g) => g.score));
  if (tr.length >= GAP_MIN_GAMES && co.length >= GAP_MIN_GAMES) {
    const gap = average(tr)! - average(co)!;
    if (gap >= GAP_MIN)
      candidates.push({
        id: 'verseny',
        text: `Minden dobás előtt csináld ugyanazt (kéztörlés, mély levegő, hova célzok), és edzésen az utolsó játékban tűzz ki egy elérendő pontszámot, mert versenyen ${Math.round(gap)} ponttal gyengébb vagy.`,
        source: `edzés ${r1(average(tr)!)} (${tr.length} játék), verseny ${r1(average(co)!)} (${co.length} játék)`,
        lossPerGame: gap,
      });
  }

  if (candidates.length) {
    // A legnagyobb becsült veszteség nyer; egyenlőségnél a fenti sorrend (stabil rendezés).
    return [...candidates].sort((a, b) => (b.lossPerGame ?? 0) - (a.lossPerGame ?? 0))[0];
  }

  // 5) Nincs elég adat: mit rögzíts.
  if (st.games < 3)
    return {
      id: 'adat',
      text: `Rögzíts legközelebb ${3 - st.games === 1 ? 'még 1 játékot' : `${3 - st.games} játékot`} dobásonként (▦ gomb), hogy lássam, melyik megmaradt bábuk viszik el a legtöbb pontot.`,
      source: `${st.games} dobásonként rögzített játék van (legalább 3 kell)`,
      lossPerGame: null,
    };
  if (st.dir.bal + st.dir.jobb + st.dir.zseb < DIR_MIN_MISSES)
    return {
      id: 'adat',
      text: 'Dobásonkénti rögzítésnél jelöld az első dobás irányát is, hogy kiderüljön, rendszeresen ugyanarra téveszted-e.',
      source: `${st.dir.zseb + st.dir.bal + st.dir.jobb} jelölt első dobás az utolsó ${st.games} játékban`,
      lossPerGame: null,
    };
  if (cs.n < MIN_SAMPLE)
    return {
      id: 'adat',
      text: `Rögzíts még ${MIN_SAMPLE - cs.n} legalább kétjátékos alkalmat a bemelegítéssel együtt, hogy lássam, gyengébb-e az 1. játékod.`,
      source: `${cs.n} kétjátékos alkalom van (legalább ${MIN_SAMPLE} kell)`,
      lossPerGame: null,
    };
  return {
    id: 'adat',
    text: 'Most nincs kiugró hiba: csináld tovább így, és rögzíts minden játékot dobásonként, hogy a következő gyenge pont is kiderüljön.',
    source: `${st.games} dobásonként rögzített játék, ${cs.n} kétjátékos alkalom: egyik szabály sem jelez`,
    lossPerGame: null,
  };
}
