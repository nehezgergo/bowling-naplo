/**
 * Beépített, szabályalapú edző. Offline működik, ingyenes, és csak a saját
 * adataidból dolgozik. Minden tipp egy mért eltérésre épül, küszöbökkel, hogy
 * kevés adatból ne vonjon le elhamarkodott következtetést.
 */
import { addGameStats, emptyFrameStats, pct, sessionFrameStats } from '../domain/scoring';
import { average, flattenGames, isCompetition, isTraining, sessionAverage, type GameRef } from '../domain/stats';
import type { Profile, Session, Settings } from '../domain/types';
import { fmtAvg } from '../util/format';

export type TipLevel = 'jo' | 'figyelem' | 'info';

export interface CoachTip {
  id: string;
  level: TipLevel;
  title: string;
  text: string;
  /** Konkrét feladat a következő edzésre (ha van). */
  drill?: string;
  /** Nagyobb = fontosabb. */
  priority: number;
}

export const stdDev = (xs: number[]): number | null => {
  const m = average(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Jobb/bal oldal a kezességhez igazítva (balkezesnél tükrözve). */
function sides(p: Profile) {
  const left = p.hand === 'bal';
  return {
    strongSide: left ? 'bal' : 'jobb',
    weakSide: left ? 'jobb' : 'bal',
    cornerPin: left ? '7-es' : '10-es',
  };
}

const r1 = (n: number) => fmtAvg(n);

export interface CoachInput {
  sessions: Session[];
  settings: Settings;
  today: string;
}

export function coachTips({ sessions, settings, today }: CoachInput): CoachTip[] {
  const games = flattenGames(sessions);
  const scores = games.map((g) => g.score);
  const tips: CoachTip[] = [];
  const s = sides(settings.profile);
  if (games.length < 3) return tips;

  // 1) Forma: utolsó 20 az előző 20-hoz.
  const last20 = scores.slice(-20);
  const prev20 = scores.slice(-40, -20);
  if (last20.length >= 10 && prev20.length >= 10) {
    const diff = average(last20)! - average(prev20)!;
    if (diff >= 5)
      tips.push({
        id: 'forma-fel',
        level: 'jo',
        priority: 60,
        title: 'Emelkedő forma',
        text: `Az utolsó ${last20.length} játék átlaga ${r1(diff)} ponttal jobb az előzőnél. Amit mostanában csinálsz, az működik: tartsd meg a rutint, és most ne változtass egyszerre több dolgon.`,
      });
    else if (diff <= -5)
      tips.push({
        id: 'forma-le',
        level: 'figyelem',
        priority: 75,
        title: 'Visszaesés az utóbbi játékokban',
        text: `Az utolsó ${last20.length} játék átlaga ${r1(-diff)} ponttal gyengébb az előzőnél. Ilyenkor általában az alapok csúsznak el: kiinduló pont, tempó, célpont. Ne a golyót vagy a vonalat cseréld először.`,
        drill: 'Edzés elején 10 dobás csak a felvezetésre: ugyanarról a boardról indulsz, ugyanarra a nyílra nézel, egyenletes 4–5 lépéssel. Az eredmény most nem számít, csak az ismétlés.',
      });
  }

  // 2) Edzés–verseny különbség.
  const tr = games.filter((g) => isTraining(g.type)).map((g) => g.score);
  const co = games.filter((g) => isCompetition(g.type)).map((g) => g.score);
  if (tr.length >= 6 && co.length >= 6) {
    const gap = average(co)! - average(tr)!;
    if (gap <= -8)
      tips.push({
        id: 'verseny-nyomas',
        level: 'figyelem',
        priority: 80,
        title: 'Versenyen gyengébb vagy, mint edzésen',
        text: `A versenyátlagod ${r1(-gap)} ponttal marad el az edzésátlagodtól. A tudás megvan, a nyomás alatti ismétlés hiányzik. Erre a legjobb eszköz egy fix rutin minden dobás előtt.`,
        drill: 'Építs ki egy 10 másodperces rutint: törlöd a kezed, egy mély levegő, kimondod magadban a célpontot, indulás. Edzésen minden dobás előtt csináld végig, így versenyen is automatikus lesz. Az utolsó edzésjátékot játszd „tétre”: előre kitűzött pontszám, amit el kell érned.',
      });
    else if (gap >= 5)
      tips.push({
        id: 'verseny-jo',
        level: 'jo',
        priority: 40,
        title: 'Versenyen jobban teljesítesz',
        text: `A versenyátlagod ${r1(gap)} ponttal jobb, mint edzésen. Jól kezeled a nyomást. Lehet, hogy edzésen kevésbé koncentrálsz, ezért ott is tűzz ki konkrét célt minden alkalomra.`,
      });
  }

  // 3) Konzisztencia: szórás az utolsó 20 játékban.
  const sd = stdDev(last20);
  if (sd !== null && last20.length >= 10) {
    if (sd >= 28)
      tips.push({
        id: 'szoras-nagy',
        level: 'figyelem',
        priority: 70,
        title: 'Nagy a különbség a játékaid között',
        text: `Az utolsó játékaid szórása ${r1(sd)} pont: a jó és a rossz játék nagyon messze van egymástól. A rossz játékokat szinte mindig a kihagyott spare-ek és a nyitott frame-ek okozzák, nem a kevés strike.`,
        drill: 'Fél edzés csak spare-re: minden dobás után képzelj el egy maradék bábut, és arra dobj. A cél, hogy egy játékban legfeljebb 2 nyitott frame-ed legyen.',
      });
    else if (sd <= 15)
      tips.push({
        id: 'szoras-kicsi',
        level: 'jo',
        priority: 35,
        title: 'Egyenletes játék',
        text: `A szórásod mindössze ${r1(sd)} pont, a játékaid kiszámíthatók. A következő szint a strike-arány javítása: egy jól beállított belépési pont (a ${s.strongSide} oldali „zseb”).`,
      });
  }

  // 4) Bemelegítés és kitartás: 1. játék vs 3.+ játékok, többjátékos alkalmakon.
  const multi = sessions.filter((x) => x.games.length >= 3);
  if (multi.length >= 4) {
    const firsts: number[] = [];
    const lates: number[] = [];
    for (const x of multi) {
      const g = [...x.games].sort((a, b) => a.index - b.index);
      firsts.push(g[0].score);
      lates.push(...g.slice(2).map((y) => y.score));
    }
    const restAvg = average(multi.flatMap((x) => [...x.games].sort((a, b) => a.index - b.index).slice(1).map((y) => y.score)))!;
    const firstAvg = average(firsts)!;
    const lateAvg = average(lates)!;
    if (restAvg - firstAvg >= 8)
      tips.push({
        id: 'bemelegites',
        level: 'figyelem',
        priority: 65,
        title: 'Lassan indulsz',
        text: `Az első játékod átlaga (${r1(firstAvg)}) ${r1(restAvg - firstAvg)} ponttal alacsonyabb a többinél. Az első frame-ek „bemelegítéssel” mennek el.`,
        drill: 'Érkezz 10 perccel korábban: nyújtás, néhány üres lendítés golyóval. A gyakorló dobásoknál már versenytempóban, teljes rutinnal dobj, és figyeld, hol fordul be a golyó.',
      });
    else if (firstAvg - lateAvg >= 8)
      tips.push({
        id: 'kitartas',
        level: 'figyelem',
        priority: 65,
        title: 'A végére elfáradsz',
        text: `A 3. és későbbi játékaid átlaga (${r1(lateAvg)}) ${r1(firstAvg - lateAvg)} ponttal az első játék alatt van. Ez tipikusan fáradás: rövidül a lendítés, gyorsul a tempó, vagy leesik a kar a kiengedésnél.`,
        drill: 'Játékok között igyál vizet és rázd ki a kart. Ha a golyó nehéznek tűnik a végére, próbálj ki egy játékot a könnyebb golyóval. Heti 2× 15 perc alkar- és vállerősítés sokat segít.',
      });
  }

  // 5) Nagy bukások: 100 alatti játékok aránya.
  const under = last20.filter((x) => x < 100).length;
  if (last20.length >= 10 && under / last20.length >= 0.15)
    tips.push({
      id: 'bukasok',
      level: 'figyelem',
      priority: 72,
      title: 'Túl sok a 100 alatti játék',
      text: `Az utolsó ${last20.length} játékból ${under} ment 100 alá. Egy-egy ilyen játék az egész átlagot lehúzza. A gyors javulás kulcsa a biztos spare, főleg az egyes bábuknál.`,
      drill: `Spare-rendszer: a strike-célpontot (nyilat) megtartod, csak a lábadat teszed máshova. A ${s.weakSide} oldali bábukhoz ${s.strongSide}ra lépsz (3, 6 vagy 9 boardot, ahogy távolodik a bábu), a ${s.cornerPin} bábuhoz a pálya másik széléről, keresztben, egyenesen dobj, akár spare golyóval.`,
    });

  // 6) Golyók összevetése.
  const byBall = new Map<string, number[]>();
  for (const g of games) {
    if (g.ball === 'Nincs megadva') continue;
    if (!byBall.has(g.ball)) byBall.set(g.ball, []);
    byBall.get(g.ball)!.push(g.score);
  }
  const balls = [...byBall.entries()].filter(([, v]) => v.length >= 10).map(([k, v]) => ({ k, avg: average(v)!, n: v.length }));
  if (balls.length >= 2) {
    balls.sort((a, b) => b.avg - a.avg);
    const diff = balls[0].avg - balls[balls.length - 1].avg;
    if (diff >= 10)
      tips.push({
        id: 'golyo',
        level: 'info',
        priority: 45,
        title: `A(z) ${balls[0].k} megy jobban`,
        text: `A(z) ${balls[0].k} golyóval ${r1(balls[0].avg)} az átlagod, a(z) ${balls[balls.length - 1].k} golyóval ${r1(balls[balls.length - 1].avg)}. Ez ${r1(diff)} pont különbség. Strike-dobásra a jobbat használd. Ha a gyengébb a spare golyód, azt ne a teljes átlag alapján ítéld meg.`,
      });
  }

  // 7) Fáradtság és eredmény (az „Az edzőnek” mezőkből).
  const tired = sessions.filter((x) => (x.coach?.fatigue ?? 0) >= 4);
  const fresh = sessions.filter((x) => x.coach?.fatigue && x.coach.fatigue <= 2);
  if (tired.length >= 3 && fresh.length >= 3) {
    const diff = average(fresh.map((x) => sessionAverage(x)!))! - average(tired.map((x) => sessionAverage(x)!))!;
    if (diff >= 10)
      tips.push({
        id: 'faradtsag',
        level: 'info',
        priority: 50,
        title: 'A fáradtság sokat számít nálad',
        text: `Frissen átlagosan ${r1(diff)} ponttal jobban dobsz, mint fáradtan. Fontos versenyek előtti napon pihenj, és fáradtan inkább technikai edzést tarts, ne pontszámra játssz.`,
      });
  }

  // 8) Olajozás.
  const byOil = new Map<string, number[]>();
  for (const x of sessions) {
    const o = x.coach?.oil;
    if (!o || o === 'ismeretlen') continue;
    if (!byOil.has(o)) byOil.set(o, []);
    byOil.get(o)!.push(...x.games.map((g) => g.score));
  }
  const oils = [...byOil.entries()].filter(([, v]) => v.length >= 6).map(([k, v]) => ({ k, avg: average(v)! }));
  if (oils.length >= 2) {
    oils.sort((a, b) => a.avg - b.avg);
    const worst = oils[0];
    const diff = oils[oils.length - 1].avg - worst.avg;
    const label: Record<string, string> = { rovid: 'rövid', kozepes: 'közepes', hosszu: 'hosszú' };
    const advice: Record<string, string> = {
      rovid: `Rövid olajon a golyó korán fordul: menj beljebb a lábaddal és a célponttal is, és használj kevésbé agresszív golyót. Ha túl sok a „high hit”, lépj 2 boardot ${s.weakSide}ra, és a célpontot is vidd ugyanannyival.`,
      kozepes: 'Közepes olajon kezdj a szokásos vonaladon, és az első 2–3 frame alapján igazíts. Mindig a lábaddal és a célponttal együtt mozdulj: 2 board a lábbal, 1 board a célponttal.',
      hosszu: `Hosszú olajon a golyó későn fordul: játssz egyenesebb, közvetlenebb vonalon a zseb felé, és ne próbáld erőből forgatni. Erősebb felületű golyó segít.`,
    };
    if (diff >= 10)
      tips.push({
        id: 'olaj',
        level: 'info',
        priority: 48,
        title: `${label[worst.k] ?? worst.k} olajon gyengébb vagy`,
        text: `${label[worst.k] ?? worst.k} olajon ${r1(worst.avg)} az átlagod, ${r1(diff)} ponttal kevesebb, mint a legjobb olajozáson. ${advice[worst.k] ?? ''}`,
      });
  }

  // 9) Fókusz-követés.
  const focused = sessions.filter((x) => x.coach?.focusResult);
  if (focused.length >= 3) {
    const ok = focused.filter((x) => x.coach!.focusResult === 'igen').length;
    if (ok / focused.length < 0.4)
      tips.push({
        id: 'fokusz',
        level: 'info',
        priority: 30,
        title: 'A kitűzött fókusz ritkán sikerül',
        text: `Az utóbbi fókuszaidból ${ok}/${focused.length} sikerült. Lehet, hogy túl tág a cél. Egyszerre csak egy, mérhető dolgot tűzz ki (pl. „minden egyes bábus spare-t leütök”), ne általánosat („jobban dobok”).`,
      });
  }

  // 10) Rendszeresség.
  const lastDate = [...sessions].map((x) => x.date).sort().at(-1)!;
  const gapDays = daysBetween(lastDate, today);
  if (gapDays >= 21)
    tips.push({
      id: 'szunet',
      level: 'info',
      priority: 55,
      title: `${gapDays} napja nem játszottál`,
      text: 'Hosszabb kihagyás után az első alkalom legyen könnyű technikai edzés. Ne az eredményre figyelj, hanem hogy visszajöjjön az ütem és a kiengedés.',
    });

  // 12) Frame-adatokból (csak ha elég részletes játék van).
  const corner = settings.profile.hand === 'bal' ? 7 : 10;
  const fs = sessionFrameStats(sessions, corner);
  if (fs.games >= 3) {
    const spareP = pct(fs.spares, fs.spareChances);
    const strikeP = pct(fs.strikes, fs.strikeChances);
    const singleP = pct(fs.singlePinSpares, fs.singlePinChances);
    const cornerP = pct(fs.cornerSpares, fs.cornerLeaves);
    const splitP = pct(fs.splits, fs.leavesKnown);
    const p0 = (n: number) => Math.round(n);

    if (singleP !== null && fs.singlePinChances >= 10 && singleP < 75)
      tips.push({
        id: 'egybabu',
        level: 'figyelem',
        priority: 82,
        title: 'Elmaradnak az egy bábus spare-ek',
        text: `Az egy bábus állásokból csak ${p0(singleP)}%-ot ütsz le (${fs.singlePinSpares}/${fs.singlePinChances}). Ezek a legkönnyebb pontok: minden elhibázott egy bábus spare kb. 10 pontba kerül.`,
        drill: `Egy bábus spare-edzés: 10 dobás a ${corner}-es bábura, 10 a ${corner === 10 ? '7' : '10'}-esre, egyenes dobással (spare golyóval, ha van). A cél legalább 8/10 mindkettőn. Ugyanazt a célpontot használd minden alkalommal.`,
      });
    if (cornerP !== null && fs.cornerLeaves >= 5 && cornerP < 50)
      tips.push({
        id: 'sarokbabu',
        level: 'figyelem',
        priority: 68,
        title: `A ${corner}-es bábu gyakran megmarad`,
        text: `${fs.cornerLeaves}× maradt egyedül a ${corner}-es bábu, ebből ${fs.cornerSpares}-t ütöttél le (${p0(cornerP)}%). Erre ne ívelt dobással menj: a pálya ${corner === 10 ? 'bal' : 'jobb'} széléről, keresztben, egyenesen dobj.`,
        drill: `Állj a pálya ${corner === 10 ? 'bal' : 'jobb'} oldalára (kb. a 35. boardra), nézz a középső nyíl mellé, és egyenes, kissé lassabb dobással célozz átlósan a ${corner}-es bábura. 15 dobás egymás után.`,
      });
    if (spareP !== null && fs.spareChances >= 20 && spareP < 50 && !tips.some((t) => t.id === 'egybabu'))
      tips.push({
        id: 'spare-arany',
        level: 'figyelem',
        priority: 76,
        title: 'Alacsony a spare-arányod',
        text: `A spare-lehetőségek ${p0(spareP)}%-át használod ki (${fs.spares}/${fs.spareChances}). 150-es átlaghoz kb. 50–60% kell, és ez gyorsabban javítható, mint a strike.`,
        drill: 'Minden edzés második felét spare-re fordítsd: dobás előtt mondd ki magadnak, melyik bábut célzod, és hova állsz. Számold, hány sikerül.',
      });
    if (splitP !== null && fs.leavesKnown >= 20 && splitP >= 12)
      tips.push({
        id: 'split',
        level: 'info',
        priority: 54,
        title: 'Sok a split',
        text: `Az álló bábus helyzeteid ${p0(splitP)}%-a split. Ez általában azt jelenti, hogy a golyó túl egyenesen vagy túl telibe („high”) érkezik a fejbábura. A cél a zseb: jobbkezesnél az 1–3, balkezesnél az 1–2 bábu közé.`,
        drill: 'Figyeld, hol találja el a golyó a fejbábut. Ha telibe, lépj 1–2 boardot a lábaddal az ív irányába, a célpont maradjon. Egyenletes sebességgel dobj, ne erőből.',
      });
    if (strikeP !== null && spareP !== null && fs.strikeChances >= 30 && strikeP < 20 && spareP >= 60)
      tips.push({
        id: 'strike-arany',
        level: 'info',
        priority: 50,
        title: 'Jók a spare-jeid, jöhet a strike',
        text: `A spare-arányod jó (${p0(spareP)}%), de a strike-arányod csak ${p0(strikeP)}%. A következő lépés a belépési szög: egy kis ív a zsebbe sokkal több strike-ot hoz, mint egy erős, egyenes dobás.`,
      });
  }

  // 11) Cél.
  const goal = settings.goalAverage;
  const cur = average(last20);
  if (goal && cur !== null && last20.length >= 10) {
    const gap = goal - cur;
    if (gap <= 0)
      tips.push({
        id: 'cel-elerve',
        level: 'jo',
        priority: 58,
        title: 'Elérted a célátlagot',
        text: `Az utolsó ${last20.length} játék átlaga ${r1(cur)}, a célod ${goal} volt. Emeld meg 5–10 ponttal a Beállításokban, hogy legyen mi felé haladni.`,
      });
    else if (gap <= 8)
      tips.push({
        id: 'cel-kozel',
        level: 'info',
        priority: 52,
        title: 'Közel vagy a célhoz',
        text: `Már csak ${r1(gap)} pont kell a ${goal}-es átlaghoz. Egy játékra vetítve ez kb. ${Math.max(1, Math.ceil(gap / 10))} plusz spare (egy spare kb. 10 ponttal többet ér egy nyitott frame-nél).`,
      });
  }

  return tips.sort((a, b) => b.priority - a.priority);
}

/** A következő edzés fókusza: a legfontosabb figyelmeztetés feladata. */
export function nextFocus(tips: CoachTip[]): CoachTip | undefined {
  return tips.find((t) => t.level === 'figyelem' && t.drill);
}

export interface SessionFeedback {
  headline: string;
  lines: string[];
  level: TipLevel;
}

/** Rövid visszajelzés egy frissen mentett alkalomra, a korábbi játékokhoz mérve. */
export function sessionFeedback(session: Session, allSessions: Session[]): SessionFeedback {
  const before: GameRef[] = flattenGames(allSessions.filter((x) => x.id !== session.id && (x.date < session.date || (x.date === session.date && x.createdAt < session.createdAt))));
  const prev = before.map((g) => g.score).slice(-20);
  const scores = [...session.games].sort((a, b) => a.index - b.index).map((g) => g.score);
  const avg = average(scores)!;
  const lines: string[] = [];
  let level: TipLevel = 'info';
  let headline = `Mai átlag: ${r1(avg)}`;

  const prevBest = before.length ? Math.max(...before.map((g) => g.score)) : null;
  const best = Math.max(...scores);
  if (prevBest !== null && best > prevBest) {
    headline = `Új egyéni csúcs: ${best}!`;
    level = 'jo';
  }

  const ref = average(prev);
  if (ref !== null && prev.length >= 5) {
    const d = avg - ref;
    if (d >= 5) {
      lines.push(`${r1(d)} ponttal jobb, mint az előző ${prev.length} játékod átlaga (${r1(ref)}).`);
      level = 'jo';
    } else if (d <= -5) {
      lines.push(`${r1(-d)} ponttal elmarad az előző ${prev.length} játékod átlagától (${r1(ref)}). Egy rossz nap belefér. Nézd meg, mi volt más: fáradtság, pálya, golyó?`);
      if (level !== 'jo') level = 'figyelem';
    } else lines.push(`Hozod a szokásos szintedet (előző ${prev.length} játék átlaga: ${r1(ref)}).`);
  } else if (prevBest === null) {
    lines.push('Ez az első rögzített alkalmad. Innen méred a fejlődést!');
  }

  if (scores.length >= 3) {
    const first = scores[0];
    const rest = average(scores.slice(1))!;
    if (rest - first >= 15) lines.push(`Az első játék (${first}) jóval gyengébb volt a többinél: legközelebb melegíts be alaposabban.`);
    else {
      const lastTwo = average(scores.slice(-2))!;
      // Csak akkor esés, ha a végén a szokásos szint alá is került.
      if (first - lastTwo >= 15 && (ref === null || lastTwo < ref))
        lines.push('A végére visszaestél: figyelj a tempóra és a pihenőkre a játékok között.');
    }
    const sd = stdDev(scores)!;
    if (sd <= 8) lines.push('Nagyon egyenletes alkalom volt.');
  }

  const fs = emptyFrameStats();
  for (const g of session.games) if (g.frames) addGameStats(fs, g.frames);
  if (fs.games > 0)
    lines.push(
      `Frame-ek (${fs.games} játék): ${fs.strikes} strike, spare ${fs.spares}/${fs.spareChances}, ${fs.opens} nyitott frame.`,
    );

  const c = session.coach;
  if (c?.focusGoal && c.focusResult === 'igen') lines.push(`A mai fókusz („${c.focusGoal}”) sikerült. Szép munka!`);
  if (c?.focusGoal && c.focusResult === 'nem') lines.push(`A mai fókusz („${c.focusGoal}”) nem jött össze. Legközelebb bontsd kisebb, mérhető lépésre.`);

  return { headline, lines, level };
}
