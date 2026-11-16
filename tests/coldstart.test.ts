import { describe, expect, it } from 'vitest';
import { bestWarmup, coldStart, warmupBuckets } from '../src/domain/coldstart';
import { CURRENT_SCHEMA, emptyData, type Session } from '../src/domain/types';
import { migrate, normalize } from '../src/storage/db';
import { applySeeds, COLDSTART_SEED, latestEntered } from '../src/storage/seeds';
import { fmtAvg } from '../src/util/format';

let n = 0;
const s = (type: string, scores: number[], extra: Partial<Session> = {}, date = '2026-01-01'): Session => ({
  id: `t${++n}`, date, type, games: scores.map((score, i) => ({ index: i + 1, score })),
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...extra,
});

describe('kezdő adatok: a 7 verseny', () => {
  const seeded = applySeeds(emptyData(), '2026-11-16T00:00:00.000Z');

  it('ellenőrző értékek: 1. játék 128,3; 2. játék 140,7; 7-ből 5-ször a második jobb', () => {
    const c = coldStart(seeded.data.sessions, 'verseny');
    expect(c.n).toBe(7);
    expect(fmtAvg(c.firstAvg)).toBe('128,3');
    expect(fmtAvg(c.secondAvg)).toBe('140,7');
    expect(c.secondBetter).toBe(5);
    expect(c.enough).toBe(true);
  });

  it('a Hivatal Kupák helyezéssel és indulószámmal jönnek', () => {
    const xxv = seeded.data.sessions.find((x) => x.eventName === 'XXV. Hivatal Kupa')!;
    expect(xxv.type).toBe('hivatal_kupa');
    expect(xxv.competition).toEqual({ ownRank: 4, entrants: 93 });
    expect(xxv.games.map((g) => g.score)).toEqual([177, 147]);
  });

  it('egyszer kerül be; másodszor nem duplikál', () => {
    expect(seeded.added).toBe(7);
    expect(seeded.data.appliedSeeds).toContain(COLDSTART_SEED);
    const again = applySeeds(seeded.data);
    expect(again.changed).toBe(false);
    expect(again.data.sessions).toHaveLength(7);
  });

  it('a már meglévő (más azonosítójú) azonos alkalmat kihagyja', () => {
    const own = s('kupa', [137, 158], { eventName: 'téli kupa' }, '2025-02-20');
    const sameMonth = s('hivatal_kupa', [117, 137], {}, '2025-11-08');
    const r = applySeeds({ ...emptyData(), sessions: [own, sameMonth] });
    expect(r.added).toBe(5);
    expect(r.data.sessions).toHaveLength(7);
  });

  it('a törölt kezdő alkalom nem jön vissza', () => {
    const without = { ...seeded.data, sessions: seeded.data.sessions.filter((x) => x.id !== 'seed-teli-kupa-2025') };
    expect(applySeeds(without).data.sessions).toHaveLength(6);
  });

  it('ha a típusokat közben törölted, visszakerülnek', () => {
    const d = emptyData();
    d.settings.sessionTypes = [{ id: 'edzes', label: 'Edzés', kind: 'edzes' }];
    const ids = applySeeds(d).data.settings.sessionTypes.map((t) => t.id);
    expect(ids).toEqual(['edzes', 'kupa', 'hivatal_kupa']);
  });
});

describe('1. és 2. játék', () => {
  it('edzés és verseny külön; a későbbi játékok átlaga is', () => {
    const sessions = [s('edzes', [100, 120, 140]), s('edzes', [130, 130]), s('kupa', [150, 140])];
    const tr = coldStart(sessions, 'edzes');
    expect(tr.n).toBe(2);
    expect(tr.firstAvg).toBe(115);
    expect(tr.secondAvg).toBe(125);
    expect(tr.laterAvg).toBeCloseTo((120 + 140 + 130) / 3);
    expect(tr.secondBetter).toBe(1);
    expect(tr.ties).toBe(1);
    expect(tr.enough).toBe(false);
    expect(coldStart(sessions, 'verseny').firstAvg).toBe(150);
  });
  it('egyjátékos alkalmak nem számítanak', () => {
    expect(coldStart([s('edzes', [150])]).n).toBe(0);
  });
});

describe('bemelegítés', () => {
  const w = (shots: number, first: number, extra: Partial<Session> = {}) => s('kupa', [first, 150], { ...extra, warmup: { ...extra.warmup, shots } });

  it('csoportok határai: 5 → 0–5, 6 és 10 → 6–10, 11 → 11+', () => {
    const b = warmupBuckets([w(5, 100), w(6, 110), w(10, 120), w(11, 130)]);
    expect(b.map((x) => x.n)).toEqual([1, 2, 1]);
  });
  it('5 alkalom alatt nincs átlag (kevés adat), csak tájékoztató', () => {
    const b = warmupBuckets([w(3, 100), w(4, 110)]);
    expect(b[0]).toMatchObject({ n: 2, firstAvg: null, rawAvg: 105 });
    expect(bestWarmup([w(3, 100), w(4, 110)])).toBeNull();
  });
  it('a legjobb csoport és annak legjobb rutinja', () => {
    const few = [1, 2, 3, 4, 5].map((i) => w(3, 110 + i));
    const many = [1, 2, 3, 4, 5].map((i) => w(8, 130 + i, { warmup: { routine: i === 4 ? 'nyújtás + 2 spare-dobás' : undefined, minutes: 10 } }));
    const best = bestWarmup([...few, ...many])!;
    expect(best.bucket.key).toBe('6-10');
    expect(best.bucket.firstAvg).toBe(133);
    expect(best.routine).toBe('nyújtás + 2 spare-dobás');
    expect(best.routineFirst).toBe(134);
    expect(best.avgMinutes).toBe(10);
  });
});

describe('migráció', () => {
  it('v1 → v2: minden adat megmarad, az új mezők üresek', () => {
    const v1 = { schemaVersion: 1, sessions: [s('edzes', [150, 160])], settings: { goalAverage: 155, balls: ['12 lb'] }, coachReports: [] };
    const m = migrate(v1 as unknown as Record<string, unknown>);
    expect(m.schemaVersion).toBe(2);
    const d = normalize(v1);
    expect(d.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(d.sessions).toEqual(v1.sessions);
    expect(d.settings.goalAverage).toBe(155);
    expect(d.appliedSeeds).toEqual([]);
  });
  it('verzió nélküli (legrégebbi) adat is betölthető', () => {
    expect(normalize({ sessions: [], settings: {} }).schemaVersion).toBe(2);
  });
});

describe('kezdő adatok és az új alkalom alapértékei', () => {
  it('a kezdő alkalmak létrehozási ideje a verseny napja, nem a betöltésé', () => {
    const own = s('edzes', [150, 150], {}, '2026-11-10');
    const r = applySeeds({ ...emptyData(), sessions: [own] }, '2026-11-16T09:00:00.000Z');
    // A XXV. Hivatal Kupa (nov. 15.) későbbi, mint a saját edzés (nov. 10.), mégis a saját bejegyzés az alap.
    expect(latestEntered(r.data.sessions)!.id).toBe(own.id);
    expect(latestEntered(applySeeds(emptyData()).data.sessions)!.id).toBe('seed-hivatal-xxv');
    expect(r.data.sessions.find((x) => x.id === 'seed-hivatal-xxv')!.updatedAt).toBe('2026-11-16T09:00:00.000Z');
  });
});
