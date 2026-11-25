/** Játék közbeni AI-tanács: az elküldött adatok és a válasz ellenőrzése (hálózat nélkül, tesztelhető). */
import { frameMarks, pct, scoreGame, sessionFrameStats, worstLeaves } from '../domain/scoring';
import { dashboard } from '../domain/stats';
import { typeLabel, type AppData, type Frame, type SessionCoach } from '../domain/types';
import { PLAIN_RULES } from './prompt';

/** A folyamatban lévő alkalom körülményei és a már befejezett játékai. */
export interface LiveContext {
  type: string;
  ball?: string;
  coach: SessionCoach;
  /** Ennek az alkalomnak a korábbi játékai. */
  games: { no: number; score: number; frames?: Frame[]; ball?: string }[];
}

/** Az éppen játszott játék (ha dobásonként rögzíti). */
export interface LiveGame {
  no: number;
  ball?: string;
  frames: Frame[];
  /** Az első dobás után most álló bábuk, ha a kör második dobása következik. */
  standing?: number[];
}

export interface LiveAdvice {
  now: string;
  why: string;
  steps: string[];
}

export const LIVE_SYSTEM = `Bowlingedző vagy, aki a pálya mellett áll egy amatőr játékos mögött. A játékos két dobás között, telefonon kér tanácsot, és azonnal folytatja a játékot.

- Egyetlen dolgot mondj, amit a következő dobásnál kipróbálhat. Ne sorolj fel mindent.
- Ha a kör második dobása következik, a megmaradt bábukra adj tanácsot: hova álljon, hova nézzen. Ha új kör jön, az első dobásra.
- Csak az elküldött adatokra építs. Kevés dobásból ne vonj le messzemenő következtetést: ha nincs egyértelmű minta, mondd, hogy ne változtasson semmin, és miért.
- Egy-két rossz dobás után ne javasolj átállást. Ha ugyanaz az irányhiba legalább kétszer ismétlődött, kicsi módosítást javasolj.
- Nem látod a dobást, csak az eredményét. Ne állítsd, hogy a mozdulatát láttad.
- A kezességet vedd figyelembe. Ha nincs megadva, jobbkezesnek vedd, és ezt ne részletezd.
- Magyarul, tegezve, nyugodt és bátorító hangon.
${PLAIN_RULES}`;

export const LIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['now', 'why', 'steps'],
  properties: {
    now: { type: 'string', description: 'A tanács egyetlen rövid mondatban, legfeljebb 20 szó.' },
    why: { type: 'string', description: 'Miért, egy mondatban, az ő dobásaira hivatkozva.' },
    steps: { type: 'array', items: { type: 'string' }, description: '1–3 nagyon rövid teendő: hova állj, hova nézz, hogyan dobj.' },
  },
} as const;

export function parseLive(text: string): LiveAdvice {
  let r: Partial<LiveAdvice> | null;
  try {
    r = JSON.parse(text) as Partial<LiveAdvice>;
  } catch {
    throw new Error('A tanács nem érkezett meg teljesen. Próbáld újra.');
  }
  if (!r || typeof r.now !== 'string' || typeof r.why !== 'string' || !Array.isArray(r.steps) || !r.steps.every((s) => typeof s === 'string'))
    throw new Error('A tanács nem a várt formában érkezett. Próbáld újra.');
  return r as LiveAdvice;
}

const DIR = { zseb: 'jó irány', bal: 'balra ment', jobb: 'jobbra ment' };

function frameLine(f: Frame, i: number): string {
  const extra = [
    f.firstBall ? `első dobás: ${DIR[f.firstBall]}` : '',
    f.pinsLeft?.length ? `első után maradt: ${f.pinsLeft.join(', ')}` : '',
    f.pinsAfter ? `második után maradt: ${f.pinsAfter.join(', ') || 'semmi'}` : '',
  ].filter(Boolean);
  return `${i + 1}. kör: ${frameMarks(f).join(' ')}${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

const OIL: Record<string, string> = { rovid: 'rövid', kozepes: 'közepes', hosszu: 'hosszú', ismeretlen: 'nem tudja' };
const LANE: Record<string, string> = { szaraz: 'száraz', normal: 'normál', olajos: 'olajos' };

export function buildLiveMessage(data: AppData, ctx: LiveContext, game?: LiveGame): string {
  const p = data.settings.profile;
  const d = dashboard(data.sessions);
  const fs = sessionFrameStats(data.sessions, p.hand === 'bal' ? 7 : 10);
  const c = ctx.coach;
  const out = [
    '## Játékos',
    `${p.hand === 'bal' ? 'Balkezes' : p.hand === 'jobb' ? 'Jobbkezes' : 'Kezesség nincs megadva'}; ${p.style === 'ketkezes' ? 'kétkezes dobás' : p.style === 'egykezes' ? 'egykezes dobás' : 'stílus nincs megadva'}. Átlaga ${d.all.average?.toFixed(0) ?? '–'}, utolsó 20 játéké ${d.last20Avg?.toFixed(0) ?? '–'}.`,
  ];
  if (p.ballsDescription) out.push(`Golyói: ${p.ballsDescription}`);
  if (fs.games)
    out.push(
      `Korábbi dobásai (${fs.games} játék): strike ${Math.round(pct(fs.strikes, fs.strikeChances) ?? 0)}%, spare ${Math.round(pct(fs.spares, fs.spareChances) ?? 0)}%. Gyakran elhibázott maradék: ${worstLeaves(fs, 2, 3).map((w) => `${w.key} (${w.made}/${w.n})`).join(', ') || '–'}. Irány: jó ${fs.dir.zseb + fs.dir.strike}, balra ${fs.dir.bal}, jobbra ${fs.dir.jobb}.`,
    );
  out.push(
    '\n## Ma',
    [
      typeLabel(ctx.type),
      `golyó: ${game?.ball || ctx.ball || '–'}`,
      c.lanes ? `pálya: ${c.lanes}` : '',
      c.oil ? `olajozás: ${OIL[c.oil]}` : '',
      c.laneCondition ? `pálya állapota: ${LANE[c.laneCondition]}` : '',
      c.target ? `ide céloz: ${c.target}` : '',
      c.focusGoal ? `erre figyel: ${c.focusGoal}` : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  for (const g of ctx.games) {
    out.push(`${g.no}. játék: ${g.score} pont${g.ball ? ` (golyó: ${g.ball})` : ''}`);
    if (g.frames) out.push(...g.frames.map(frameLine).map((l) => `  ${l}`));
  }
  if (game) {
    const rolled = game.frames.filter((f) => f.rolls.length);
    out.push(`\n## A most játszott, ${game.no}. játék (eddig ${scoreGame(game.frames).total} biztos pont)`, ...rolled.map(frameLine));
    out.push(
      game.standing
        ? `\n## Kérdés\nMost a kör második dobása jön, ezek a bábuk állnak: ${game.standing.join(', ')}. Hogyan dobjak?`
        : '\n## Kérdés\nMost új kör első dobása jön. Hogyan játsszak tovább?',
    );
  } else out.push('\n## Kérdés\nÚj játék következik. Mire figyeljek benne?');
  return out.join('\n');
}
