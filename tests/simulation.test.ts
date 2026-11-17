import { describe, expect, it } from 'vitest';
import {
  averageCutoffs,
  buildPools,
  chanceText,
  defaultCutoff,
  liveTarget,
  mulberry32,
  noiseFor,
  simulateTwoGames,
} from '../src/domain/simulation';
import { emptyData, type Session } from '../src/domain/types';
import { exportBenchmarksCsv, isBenchmarkCsv, mergeBenchmarks, parseBenchmarksCsv, parseCutoffs } from '../src/storage/fieldIo';
import { exportJson, parseImport, parseJsonImport } from '../src/storage/io';
import { applySeeds, FIELD_ROWS, FIELD_SEED } from '../src/storage/seeds';

let n = 0;
const uid = () => `b${++n}`;
const s = (type: string, scores: number[], date: string): Session => ({
  id: `s${++n}`, date, type, games: scores.map((score, i) => ({ index: i + 1, score })),
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`,
});

describe('véletlenszám-generátor', () => {
  it('azonos seed → azonos sorozat, [0,1) tartományban', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(xs[0]);
  });
});

describe('kétjátékos szimuláció', () => {
  it('állandó mintánál pontos eredmény', () => {
    const r = simulateTwoGames({ all: [130, 150], first: [130, 130, 130, 130, 130], later: [150, 150, 150, 150, 150] }, { seed: 1 })!;
    expect(r.mode).toBe('kulon');
    expect([r.mean, r.p10, r.p50, r.p90]).toEqual([280, 280, 280, 280]);
    expect(r.chance(280)).toBe(1);
    expect(r.chance(281)).toBe(0);
  });

  it('ismert eloszlás: 10 érték (100…190) két húzásból, P(összeg ≥ 300) = 45%', () => {
    const v = Array.from({ length: 10 }, (_, i) => 100 + 10 * i);
    const r = simulateTwoGames({ all: v, first: [], later: [] }, { seed: 7 })!;
    expect(r.mode).toBe('kozos');
    expect(r.runs).toBe(10_000);
    expect(r.chance(300)).toBeGreaterThan(0.43);
    expect(r.chance(300)).toBeLessThan(0.47);
    expect(r.mean).toBeGreaterThan(285);
    expect(r.mean).toBeLessThan(295);
  });

  it('rögzített seeddel reprodukálható', () => {
    const pools = { all: [120, 135, 150, 101, 177, 140, 128, 160], first: [], later: [] };
    const a = simulateTwoGames(pools, { seed: 2026 })!;
    const b = simulateTwoGames(pools, { seed: 2026 })!;
    expect([a.mean, a.p10, a.p90, a.chance(279)]).toEqual([b.mean, b.p10, b.p90, b.chance(279)]);
  });

  it('külön mintázás csak elég 1. és további játéknál; különben közös', () => {
    expect(simulateTwoGames({ all: [1, 2, 3], first: [1, 2, 3, 4], later: [5, 6, 7, 8, 9] })!.mode).toBe('kozos');
    expect(simulateTwoGames({ all: [1], first: [1, 2, 3, 4, 5], later: [5, 6, 7, 8, 9] }, { splitFirst: false })!.mode).toBe('kozos');
    expect(simulateTwoGames({ all: [], first: [], later: [] })).toBeNull();
  });

  it('10 000 menet gyorsan lefut', () => {
    const t0 = performance.now();
    simulateTwoGames({ all: Array.from({ length: 40 }, (_, i) => 100 + i), first: [], later: [] });
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('minták', () => {
  const sessions = [s('edzes', [100, 110, 120], '2026-01-01'), s('kupa', [130, 140], '2026-01-02'), s('edzes', [150, 160], '2026-01-03')];
  it('a legutóbbi N játék, 1. és későbbi külön', () => {
    expect(buildPools(sessions, { games: 4, filter: 'mind' })).toEqual({ all: [130, 140, 150, 160], first: [130, 150], later: [140, 160] });
  });
  it('szűrés versenyre / edzésre', () => {
    expect(buildPools(sessions, { games: 40, filter: 'verseny' }).all).toEqual([130, 140]);
    expect(buildPools(sessions, { games: 40, filter: 'edzes' }).first).toEqual([100, 150]);
  });
});

describe('mezőny-határok', () => {
  it('alap határ: az utolsó 3 verseny 12. helyének átlaga = 279', () => {
    expect(defaultCutoff(FIELD_ROWS, 'egyeni')).toBe(279);
    expect(defaultCutoff(FIELD_ROWS, 'csapat')).toBe(1014);
    expect(defaultCutoff([], 'egyeni')).toBeNull();
  });
  it('helyezésenkénti átlagos határ', () => {
    expect(averageCutoffs(FIELD_ROWS, 'egyeni')).toEqual([
      { rank: 1, total: 385 },
      { rank: 3, total: 334 },
      { rank: 12, total: 279 },
      { rank: 13, total: 273 },
    ]);
  });
  it('kezdő adatként egyszer kerülnek be, a meglévőt nem duplikálják', () => {
    const once = applySeeds(emptyData()).data;
    expect(once.benchmarks).toHaveLength(8);
    expect(once.appliedSeeds).toContain(FIELD_SEED);
    expect(applySeeds(once).changed).toBe(false);
    const own = { ...FIELD_ROWS[3], id: 'sajat', event: 'xxv (2026 ŐSZ)' };
    expect(applySeeds({ ...emptyData(), benchmarks: [own] }).data.benchmarks).toHaveLength(8);
  });
});

describe('élő célszám', () => {
  const second = [120, 130, 140, 150, 160];
  it('mennyi kell, és milyen gyakran dobtál ennyit', () => {
    expect(liveTarget(140, 279, second)).toEqual({ need: 139, status: 'kell', hits: 3, n: 5 });
  });
  it('már megvan / lehetetlen', () => {
    expect(liveTarget(280, 279, second).status).toBe('megvan');
    expect(liveTarget(-30, 279, second).status).toBe('lehetetlen');
  });
});

describe('zajjelző', () => {
  const prior = [s('edzes', [120, 140, 130, 150, 110, 130, 140, 120, 130, 130], '2026-01-01')]; // átlag 130, szórás ≈ 11,5
  it('szokásos sávon belül, kiugróan jó, kiugróan gyenge', () => {
    expect(noiseFor(prior, '2026-02-01', 265).verdict).toBe('savon-belul');
    expect(noiseFor(prior, '2026-02-01', 290).verdict).toBe('kiugro-jo');
    expect(noiseFor(prior, '2026-02-01', 230).verdict).toBe('kiugro-gyenge');
    expect(noiseFor(prior, '2026-02-01', 265).expected).toBe(260);
  });
  it('csak a verseny előtti játékok számítanak; kevés előzménynél nincs ítélet', () => {
    expect(noiseFor(prior, '2026-01-01', 290).verdict).toBe('keves');
    expect(noiseFor([s('edzes', [130, 130], '2026-01-01')], '2026-02-01', 400).verdict).toBe('keves');
  });
});

describe('esély kiírása a mintaszámhoz mérten', () => {
  it('n < 10: nincs százalék; 10–19: kerekítve, bizonytalan; 20+: pontos', () => {
    expect(chanceText(0.58, 8)).toEqual({ text: 'kevés adat', sure: false });
    expect(chanceText(0.58, 15)).toEqual({ text: '~60% (bizonytalan)', sure: false });
    expect(chanceText(0.58, 40)).toEqual({ text: '58%', sure: true });
  });
});

describe('mezőny-határ import/export', () => {
  it('határok szöveges bevitele', () => {
    expect(parseCutoffs('1=409, 3=332; 12 297\n13:292')).toEqual([
      { rank: 1, total: 409 }, { rank: 3, total: 332 }, { rank: 12, total: 297 }, { rank: 13, total: 292 },
    ]);
    expect(parseCutoffs('12=297, 12=300')).toBeNull();
    expect(parseCutoffs('tizenkettő')).toBeNull();
    expect(parseCutoffs('')).toBeNull();
  });
  it('CSV export → import: ugyanazok a határok', () => {
    const csv = exportBenchmarksCsv(FIELD_ROWS);
    expect(isBenchmarkCsv(csv)).toBe(true);
    const { benchmarks, warnings } = parseBenchmarksCsv(csv, uid);
    expect(warnings).toEqual([]);
    expect(benchmarks.map(({ id: _i, ...b }) => b)).toEqual(FIELD_ROWS.map(({ id: _i, ...b }) => b));
  });
  it('a sima eredmény-CSV-t nem nézi mezőny-határnak; a mezőny-CSV-t felismeri', () => {
    expect(isBenchmarkCsv('Dátum;Pontszám\n2025-01-01;150\n')).toBe(false);
    const r = parseImport('hatarok.csv', 'Verseny;Kategória;Helyezés;Összpontszám\nXXVI;egyéni;12;285\n', uid);
    expect(r.benchmarks).toHaveLength(1);
    expect(r.benchmarks[0]).toMatchObject({ event: 'XXVI', category: 'egyeni', qualifyRank: 12, cutoffs: [{ rank: 12, total: 285 }] });
    expect(r.sessions).toEqual([]);
  });
  it('JSON-ban is megmaradnak', () => {
    const d = { ...emptyData(), benchmarks: FIELD_ROWS };
    expect(parseJsonImport(exportJson(d), uid).benchmarks).toEqual(FIELD_ROWS);
  });
  it('összefésülés: azonos verseny frissül, új hozzáadódik', () => {
    const upd = { ...FIELD_ROWS[0], id: 'x', cutoffs: [{ rank: 12, total: 290 }] };
    const fresh = { ...FIELD_ROWS[0], id: 'y', event: 'XXVI (2027 tavasz)' };
    const r = mergeBenchmarks(FIELD_ROWS, [upd, fresh]);
    expect([r.added, r.updated, r.list.length]).toEqual([1, 1, 9]);
    expect(r.list[0]).toMatchObject({ id: FIELD_ROWS[0].id, cutoffs: [{ rank: 12, total: 290 }] });
  });
});
