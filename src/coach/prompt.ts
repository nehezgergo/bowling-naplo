/**
 * A Claude-edzőnek küldött adatok összeállítása és a válasz ellenőrzése.
 * Tiszta függvények: nem hívnak hálózatot, tesztelhetők.
 */
import { pct, sessionFrameStats, worstLeaves } from '../domain/scoring';
import { average, dashboard, sessionAverage } from '../domain/stats';
import { typeLabel, type AppData, type CoachAdvice, type CoachReport, type Session } from '../domain/types';
import { coldStart, type ColdStart } from '../domain/coldstart';
import { times } from '../util/format';
import { coachTips, stdDev } from './rules';

const coldLine = (label: string, c: ColdStart) =>
  c.n === 0
    ? `${label}: nincs kétjátékos alkalom.`
    : `${label} az 1. játék átlaga ${c.firstAvg!.toFixed(1)}, a 2. játéké ${c.secondAvg!.toFixed(1)}; ${c.n} alkalomból ${times(c.secondBetter)} volt jobb a 2.${c.enough ? '' : ' (kevés adat)'}`;

export const COACH_MODEL = 'claude-opus-5-5';
/** Claude Opus 5.5 ára (USD / millió token): bemenet, kimenet. */
const PRICE_IN = 4;
const PRICE_OUT = 20;

export const estimateCostUsd = (inputTokens: number, outputTokens: number) =>
  (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;

export const SYSTEM_PROMPT = `Tapasztalt bowlingedző vagy, aki egyetlen amatőr játékos egyéni fejlődését segíti. A játékos a saját naplóalkalmazásából küldi az adatait: statisztikát, a legutóbbi alkalmakat, a saját megjegyzéseit és a korábbi tanácsaidat.

Hogyan dolgozz:
- Magyarul, tegezve, közvetlen és bátorító, de őszinte hangon írj, úgy, ahogy egy jó edző beszél a pálya mellett.
- Minden megállapítást a küldött számokra és megjegyzésekre építs, és nevezd meg a számot, amire támaszkodsz. Ha valamihez kevés az adat, mondd ki, és ne találgass.
- Általános bowlingtanács helyett a játékos konkrét gyengeségeire adj megoldást: technika (kiinduló pont, célpont, tempó, kiengedés), spare-rendszer, pályaolvasás és igazítás, golyóválasztás, mentális rutin, erőnlét.
- A kezességet (jobb/bal) vedd figyelembe minden oldalra, bábura és irányra vonatkozó tanácsnál.
- Ha vannak korábbi tanácsaid, először értékeld, mi változott azóta a számokban és a játékos fókusz-visszajelzéseiben, és erre építs: ami működött, azt erősítsd, ami nem, azt igazítsd vagy cseréld.
- Legfeljebb 3 fókuszterületet adj, fontossági sorrendben. A gyakorlatok legyenek egy edzésen elvégezhetők, ismétlésszámmal vagy mérhető céllal.
- A következő cél legyen mérhető és reális a következő 1–3 alkalomra (pl. spare-arány, nyitott frame-ek száma, átlag).
- Ha a játékos kérdezett valamit, arra a megfelelő mezőkben, főleg az összegzésben és a fókuszterületekben válaszolj.
- Tömören fogalmazz: a játékos telefonon, akár a pálya mellett olvassa.`;

/** A válasz kötött szerkezete (JSON Schema, structured outputs). */
export const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'previousAdviceReview', 'strengths', 'focusAreas', 'drills', 'nextGoal', 'encouragement'],
  properties: {
    summary: { type: 'string', description: 'Hol tart most a játékos, mi változott; 2–4 mondat.' },
    previousAdviceReview: { type: 'string', description: 'A korábbi tanácsok értékelése a számok alapján; üres szöveg, ha nem volt korábbi tanács.' },
    strengths: { type: 'array', items: { type: 'string' }, description: '1–3 erősség, számokkal.' },
    focusAreas: {
      type: 'array',
      description: 'Legfeljebb 3 fókuszterület, fontossági sorrendben.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'how'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string', description: 'Melyik szám vagy megfigyelés miatt.' },
          how: { type: 'string', description: 'Konkrét technikai vagy mentális teendő.' },
        },
      },
    },
    drills: {
      type: 'array',
      description: '2–4 gyakorlat a következő edzésre.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'reps'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          reps: { type: 'string', description: 'Ismétlésszám vagy mérhető cél.' },
        },
      },
    },
    nextGoal: {
      type: 'object',
      additionalProperties: false,
      required: ['metric', 'target', 'why'],
      properties: {
        metric: { type: 'string' },
        target: { type: 'string' },
        why: { type: 'string' },
      },
    },
    encouragement: { type: 'string', description: 'Egy rövid, személyes zárómondat.' },
  },
} as const;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A modell válaszának ellenőrzése; hibás szerkezetnél kivételt dob. */
export function parseAdvice(text: string): CoachAdvice {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Az edző válasza nem érkezett meg teljesen. Próbáld újra.');
  }
  const r = raw as Record<string, unknown>;
  const ok =
    isObj(r) &&
    isStr(r.summary) &&
    isStr(r.previousAdviceReview) &&
    Array.isArray(r.strengths) && r.strengths.every(isStr) &&
    Array.isArray(r.focusAreas) && r.focusAreas.every((f) => isObj(f) && isStr(f.title) && isStr(f.why) && isStr(f.how)) &&
    Array.isArray(r.drills) && r.drills.every((d) => isObj(d) && isStr(d.name) && isStr(d.description) && isStr(d.reps)) &&
    isObj(r.nextGoal) && isStr(r.nextGoal.metric) && isStr(r.nextGoal.target) && isStr(r.nextGoal.why) &&
    isStr(r.encouragement);
  if (!ok) throw new Error('Az edző válasza nem a várt formában érkezett. Próbáld újra.');
  return r as unknown as CoachAdvice;
}

// ─────────────── Az elküldött adatok összeállítása ───────────────

const f1 = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(1));
const p0 = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

const OIL: Record<string, string> = { rovid: 'rövid', kozepes: 'közepes', hosszu: 'hosszú', ismeretlen: 'nem tudja' };
const LANE: Record<string, string> = { szaraz: 'száraz', normal: 'normál', olajos: 'olajos' };
const FOCUS: Record<string, string> = { igen: 'sikerült', reszben: 'részben sikerült', nem: 'nem sikerült' };

function sessionLine(s: Session): string {
  const games = [...s.games].sort((a, b) => a.index - b.index);
  const scores = games.map((g) => (g.ball && g.ball !== s.ball ? `${g.score} (${g.ball})` : String(g.score))).join(', ');
  const parts = [`${s.date} · ${typeLabel(s.type)}${s.eventName ? ` (${s.eventName})` : ''}`, `golyó: ${s.ball ?? '–'}`, `játékok: ${scores}`, `átlag ${f1(sessionAverage(s))}`];
  const c = s.coach;
  if (c) {
    const extra: string[] = [];
    // Ugyanúgy, ahogy a játékos látja: 1 = kimerült … 5 = friss.
    if (c.fatigue) extra.push(`frissesség ${6 - c.fatigue}/5 (5 = friss)`);
    if (c.concentration) extra.push(`koncentráció ${c.concentration}/5`);
    if (c.selfRating) extra.push(`önértékelés ${c.selfRating}/5`);
    if (c.oil) extra.push(`olajozás: ${OIL[c.oil]}`);
    if (c.laneCondition) extra.push(`pálya: ${LANE[c.laneCondition]}`);
    if (c.target) extra.push(`célpont: ${c.target}`);
    if (c.focusGoal) extra.push(`fókusz: „${c.focusGoal}”${c.focusResult ? ` – ${FOCUS[c.focusResult]}` : ''}`);
    if (c.wentWell) extra.push(`jól ment: „${c.wentWell}”`);
    if (c.wentBad) extra.push(`nem ment: „${c.wentBad}”`);
    if (extra.length) parts.push(extra.join('; '));
  }
  if (s.competition?.ownRank) parts.push(`helyezés: ${s.competition.ownRank}${s.competition.entrants ? `/${s.competition.entrants}` : ''}`);
  if (s.note) parts.push(`megjegyzés: „${s.note}”`);
  const w = s.warmup;
  if (w && (w.shots !== undefined || w.minutes !== undefined || w.routine))
    parts.push(`bemelegítés: ${[w.shots !== undefined ? `${w.shots} dobás` : '', w.minutes !== undefined ? `${w.minutes} perc` : '', w.routine ? `„${w.routine}”` : ''].filter(Boolean).join(', ')}`);
  const fs = sessionFrameStats([s]);
  if (fs.games) parts.push(`frame-adat (${fs.games} játék): strike ${fs.strikes}/${fs.strikeChances}, spare ${fs.spares}/${fs.spareChances}, nyitott ${fs.opens}`);
  return `- ${parts.join(' | ')}`;
}

function monthlyAverages(sessions: Session[]): string[] {
  const map = new Map<string, number[]>();
  for (const s of sessions) {
    const m = s.date.slice(0, 7);
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(...s.games.map((g) => g.score));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([m, v]) => `${m}: ${f1(average(v))} (${v.length} játék)`);
}

function previousReports(reports: CoachReport[], sessions: Session[]): string[] {
  const last = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-2);
  return last.map((r) => {
    const since = sessions.filter((s) => s.date > r.lastSessionDate);
    const sinceScores = since.flatMap((s) => s.games.map((g) => g.score));
    const a = r.advice;
    return [
      `Elemzés ${r.createdAt.slice(0, 10)} (akkor ${r.gamesCount} játék volt rögzítve, az utolsó alkalom ${r.lastSessionDate}):`,
      `  Fókuszterületek: ${a.focusAreas.map((f) => `${f.title} – ${f.how}`).join(' / ') || '–'}`,
      `  Gyakorlatok: ${a.drills.map((d) => `${d.name} (${d.reps})`).join(', ') || '–'}`,
      `  Kitűzött cél: ${a.nextGoal.metric}: ${a.nextGoal.target}`,
      `  Azóta: ${since.length} alkalom, ${sinceScores.length} játék, átlag ${f1(average(sinceScores))}`,
    ].join('\n');
  });
}

/** A felhasználói üzenet: minden, amit az edző a játékosról tud. */
export function buildCoachMessage(data: AppData, today: string, question?: string): string {
  const { sessions, settings, coachReports } = data;
  const p = settings.profile;
  const d = dashboard(sessions);
  const scores = d.games.map((g) => g.score);
  const corner = p.hand === 'bal' ? 7 : 10;
  const fs = sessionFrameStats(sessions, corner);
  const tips = coachTips({ sessions, settings, today });
  const recent = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  const out: string[] = [];
  out.push(`Mai dátum: ${today}`);
  out.push(
    '\n## Profil',
    `Kéz: ${p.hand === 'bal' ? 'balkezes' : p.hand === 'jobb' ? 'jobbkezes' : 'nincs megadva'}; stílus: ${p.style === 'ketkezes' ? 'kétkezes' : p.style === 'egykezes' ? 'egykezes' : 'nincs megadva'}; ${p.yearsPlaying !== undefined ? `${p.yearsPlaying} éve bowlingozik` : 'tapasztalat nincs megadva'}.`,
    `Golyók: ${p.ballsDescription ?? settings.balls.join(', ')}`,
    `Hosszú távú cél: ${p.longTermGoal ?? '–'}; célátlag: ${settings.goalAverage ?? '–'}`,
  );
  out.push(
    '\n## Összesítés',
    `${d.all.count} játék, ${sessions.length} alkalom. Összátlag ${f1(d.all.average)}; utolsó 20 játék átlaga ${f1(d.last20Avg)}${d.last20Change !== null ? ` (az előző 20-hoz képest ${d.last20Change >= 0 ? '+' : ''}${d.last20Change.toFixed(1)})` : ''}.`,
    `Edzésátlag ${f1(d.trainingAvg)}, versenyátlag ${f1(d.competitionAvg)}. Legjobb ${d.all.best ?? '–'}, legrosszabb ${d.all.worst ?? '–'}; 200+: ${d.all.over200}, 150+: ${d.all.over150}, 100 alatt: ${d.all.under100}.`,
    `Szórás az utolsó 20 játékban: ${f1(stdDev(scores.slice(-20)))} pont.`,
    coldLine('Versenyen', coldStart(sessions, 'verseny')),
    coldLine('Edzésen', coldStart(sessions, 'edzes')),
    `Golyónként: ${d.byBall.map((b) => `${b.key} ${f1(b.average)} (${b.count})`).join('; ') || '–'}`,
    `Típusonként: ${d.byType.map((b) => `${typeLabel(b.key as Session['type'])} ${f1(b.average)} (${b.count})`).join('; ') || '–'}`,
    `Havi átlagok: ${monthlyAverages(sessions).join('; ') || '–'}`,
  );
  if (fs.games > 0) {
    out.push(
      '\n## Frame-statisztika',
      `${fs.games} részletesen rögzített játék. Strike ${p0(pct(fs.strikes, fs.strikeChances))} (${fs.strikes}/${fs.strikeChances}), spare ${p0(pct(fs.spares, fs.spareChances))} (${fs.spares}/${fs.spareChances}), nyitott frame / játék ${(fs.opens / fs.games).toFixed(1)}.`,
      `Egy bábus spare ${p0(pct(fs.singlePinSpares, fs.singlePinChances))} (${fs.singlePinSpares}/${fs.singlePinChances}); ${corner}-es bábu egyedül ${fs.cornerLeaves}×, leütve ${fs.cornerSpares}; split ${fs.splits}× (${p0(pct(fs.splits, fs.leavesKnown))} az ismert állásokból), leütve ${fs.splitsConverted}.`,
      `Leggyakrabban elhibázott állások: ${worstLeaves(fs, 2, 5).map((w) => `${w.key} (${w.made}/${w.n})`).join(', ') || '–'}`,
      `Többbábus spare ${fs.multiPinSpares}/${fs.multiPinChances}. Első dobás iránya (jelölt): zseb ${fs.dir.zseb + fs.dir.strike} (a strike zsebnek számít), balra ${fs.dir.bal}, jobbra ${fs.dir.jobb}.`,
    );
  }
  if (tips.length) out.push('\n## Az app beépített elemzésének észrevételei', ...tips.map((t) => `- ${t.title}`));
  out.push('\n## Legutóbbi alkalmak (legfrissebb elöl)', ...(recent.length ? recent.map(sessionLine) : ['- nincs']));
  const prev = previousReports(coachReports, sessions);
  if (prev.length) out.push('\n## Korábbi tanácsaid', ...prev);
  out.push(question?.trim() ? `\n## A játékos kérdése\n${question.trim()}` : '\n## Kérés\nAdj átfogó elemzést és tervet a következő edzésekre.');
  return out.join('\n');
}
