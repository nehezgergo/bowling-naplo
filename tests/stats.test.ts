import { describe, expect, it } from 'vitest';
import {
  average,
  dashboard,
  flattenGames,
  goalProgress,
  movingAverage,
  summarize,
  trend,
} from '../src/domain/stats';
import type { Session, SessionType } from '../src/domain/types';
import { filterSessions, periodStart } from '../src/ui/log';
import { parseScore } from '../src/ui/newSession';

let n = 0;
const mk = (date: string, type: SessionType, scores: number[], ball?: string): Session => ({
  id: `s${++n}`,
  date,
  type,
  ball,
  games: scores.map((score, i) => ({ index: i + 1, score })),
  createdAt: `${date}T10:00:0${n % 10}Z`,
  updatedAt: `${date}T10:00:00Z`,
});

describe('alap számolás', () => {
  it('átlag', () => {
    expect(average([])).toBeNull();
    expect(average([100, 150, 200])).toBe(150);
  });

  it('összegzés: legjobb, legrosszabb, határok', () => {
    const s = summarize([99, 100, 149, 150, 199, 200, 300]);
    expect(s.count).toBe(7);
    expect(s.best).toBe(300);
    expect(s.worst).toBe(99);
    expect(s.over150).toBe(4); // 150, 199, 200, 300
    expect(s.over200).toBe(2); // 200, 300
    expect(s.under100).toBe(1); // 99
  });

  it('üres összegzés', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ count: 0, average: null, best: null, worst: null });
  });
});

describe('mozgóátlag', () => {
  it('az ablak telítődése előtt az eddigi játékok átlaga', () => {
    expect(movingAverage([100, 200, 300], 20)).toEqual([100, 150, 200]);
  });
  it('csúszó ablak', () => {
    expect(movingAverage([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
  });
  it('20-as ablak: a 21. pont a 2–21. játék átlaga', () => {
    const scores = Array.from({ length: 21 }, (_, i) => i + 1); // 1..21
    const ma = movingAverage(scores, 20);
    expect(ma[19]).toBeCloseTo(10.5);
    expect(ma[20]).toBeCloseTo(11.5);
  });
});

describe('trend', () => {
  it('pontos egyenesre a meredekség', () => {
    const t = trend([100, 110, 120, 130])!;
    expect(t.slope).toBeCloseTo(10);
    expect(t.intercept).toBeCloseTo(100);
  });
  it('kevés adatnál null', () => {
    expect(trend([150])).toBeNull();
  });
});

describe('dashboard', () => {
  const sessions = [
    mk('2026-01-10', 'edzes', [120, 140], '12 lb'),
    mk('2026-01-05', 'bajnoksag', [100, 110, 120], '11 lb'),
    mk('2026-01-20', 'kupa', [160]),
    mk('2026-01-25', 'egyeb', [200], '12 lb'),
  ];
  const d = dashboard(sessions);

  it('időrendbe teszi a játékokat', () => {
    expect(flattenGames(sessions).map((g) => g.score)).toEqual([100, 110, 120, 120, 140, 160, 200]);
  });

  it('összátlag játékonként (nem alkalmanként)', () => {
    expect(d.all.average).toBeCloseTo((100 + 110 + 120 + 120 + 140 + 160 + 200) / 7);
  });

  it('edzés- és versenyátlag külön, az egyéb egyikbe sem számít', () => {
    expect(d.trainingAvg).toBe(130);
    expect(d.competitionAvg).toBeCloseTo((100 + 110 + 120 + 160) / 4); // 122.5
    expect(d.competitionMinusTraining).toBeCloseTo(-7.5);
  });

  it('golyónként, a golyó nélküli játékok külön csoportban', () => {
    const byBall = Object.fromEntries(d.byBall.map((g) => [g.key, g.average]));
    expect(byBall['12 lb']).toBeCloseTo((120 + 140 + 200) / 3);
    expect(byBall['11 lb']).toBe(110);
    expect(byBall['Nincs megadva']).toBe(160);
  });

  it('a játék saját golyója felülírja az alkalomét', () => {
    const s = mk('2026-02-01', 'edzes', [150, 180], '12 lb');
    s.games[1].ball = 'Spare golyó';
    const byBall = Object.fromEntries(dashboard([s]).byBall.map((g) => [g.key, g.average]));
    expect(byBall).toEqual({ '12 lb': 150, 'Spare golyó': 180 });
  });

  it('utolsó 20 átlaga és változás az előző 20-hoz', () => {
    const many = [mk('2026-03-01', 'edzes', Array(20).fill(100)), mk('2026-03-02', 'edzes', Array(20).fill(130))];
    const dd = dashboard(many);
    expect(dd.last20Avg).toBe(130);
    expect(dd.last20Change).toBe(30);
  });

  it('üres adat', () => {
    const e = dashboard([]);
    expect(e.all.average).toBeNull();
    expect(e.last20Avg).toBeNull();
    expect(e.competitionMinusTraining).toBeNull();
  });
});

describe('cél', () => {
  it('haladás és hiány', () => {
    expect(goalProgress(150, 120)).toEqual({ goal: 150, current: 120, ratio: 0.8, gap: 30 });
  });
  it('a cél fölött a ratio 1-nél megáll', () => {
    expect(goalProgress(150, 165)!.ratio).toBe(1);
  });
  it('nincs cél vagy adat', () => {
    expect(goalProgress(undefined, 120)).toBeNull();
    expect(goalProgress(150, null)).toBeNull();
  });
});

describe('pontszám beolvasása', () => {
  it('érvényes és érvénytelen értékek', () => {
    expect(parseScore('0')).toBe(0);
    expect(parseScore(' 300 ')).toBe(300);
    expect(parseScore('301')).toBeNull();
    expect(parseScore('12.5')).toBeNull();
    expect(parseScore('')).toBeNull();
    expect(parseScore('-5')).toBeNull();
  });
});

describe('napló szűrés', () => {
  const sessions = [
    mk('2026-11-10', 'edzes', [150], '12 lb'),
    mk('2026-08-01', 'kupa', [140], '11 lb'),
    mk('2025-12-31', 'edzes', [130]),
  ];
  it('időszak kezdete', () => {
    expect(periodStart('30', '2026-11-13')).toBe('2026-10-15');
    expect(periodStart('year', '2026-11-13')).toBe('2026-01-01');
    expect(periodStart('all', '2026-11-13')).toBeNull();
  });
  it('típus, golyó és időszak szerint', () => {
    const today = '2026-11-13';
    expect(filterSessions(sessions, { type: 'edzes', ball: '', period: 'all' }, today)).toHaveLength(2);
    expect(filterSessions(sessions, { type: '', ball: '11 lb', period: 'all' }, today)).toHaveLength(1);
    expect(filterSessions(sessions, { type: '', ball: 'Nincs megadva', period: 'all' }, today)).toHaveLength(1);
    expect(filterSessions(sessions, { type: '', ball: '', period: 'year' }, today)).toHaveLength(2);
    expect(filterSessions(sessions, { type: '', ball: '', period: '30' }, today)).toHaveLength(1);
  });
});
