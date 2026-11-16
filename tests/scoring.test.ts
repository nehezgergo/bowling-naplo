import { describe, expect, it } from 'vitest';
import {
  addGameStats,
  emptyFrameStats,
  frameMarks,
  isFrameComplete,
  isFrameValid,
  isGameComplete,
  isSplit,
  pct,
  scoreGame,
  worstLeaves,
} from '../src/domain/scoring';
import type { Frame } from '../src/domain/types';

const F = (...rs: number[][]): Frame[] => rs.map((rolls) => ({ rolls }));
const repeat = (r: number[], n: number) => Array.from({ length: n }, () => [...r]);

describe('pontszámítás', () => {
  it('tökéletes játék: 300', () => {
    expect(scoreGame(F(...repeat([10], 9), [10, 10, 10])).total).toBe(300);
  });
  it('csupa nulla: 0', () => {
    expect(scoreGame(F(...repeat([0, 0], 10))).total).toBe(0);
  });
  it('csupa 9-es nyitott: 90', () => {
    expect(scoreGame(F(...repeat([9, 0], 10))).total).toBe(90);
  });
  it('csupa 5/ spare, 5 bónusz: 150', () => {
    expect(scoreGame(F(...repeat([5, 5], 9), [5, 5, 5])).total).toBe(150);
  });
  it('váltakozó strike és spare: 200', () => {
    const frames = F([10], [5, 5], [10], [5, 5], [10], [5, 5], [10], [5, 5], [10], [5, 5, 10]);
    expect(scoreGame(frames).total).toBe(200);
  });
  it('ismert vegyes játék halmozott értékekkel', () => {
    // 1: X | 7/ | 9- | X | -8 | 8/ | -6 | X | X | X81
    const frames = F([10], [7, 3], [9, 0], [10], [0, 8], [8, 2], [0, 6], [10], [10], [10, 8, 1]);
    const { total, cumulative } = scoreGame(frames);
    expect(cumulative).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
    expect(total).toBe(167);
  });
  it('hiányos játéknál a függő strike nem számít még', () => {
    const { cumulative } = scoreGame(F([10], [3]));
    expect(cumulative[0]).toBeNull();
    expect(scoreGame(F([10], [3, 4])).cumulative.slice(0, 2)).toEqual([17, 24]);
  });
});

describe('érvényesség', () => {
  it('frame 1–9', () => {
    expect(isFrameValid({ rolls: [7, 4] }, 0)).toBe(false);
    expect(isFrameValid({ rolls: [10, 0] }, 0)).toBe(false);
    expect(isFrameValid({ rolls: [7, 3] }, 0)).toBe(true);
  });
  it('10. frame', () => {
    expect(isFrameValid({ rolls: [10, 10, 10] }, 9)).toBe(true);
    expect(isFrameValid({ rolls: [10, 7, 3] }, 9)).toBe(true);
    expect(isFrameValid({ rolls: [10, 7, 5] }, 9)).toBe(false);
    expect(isFrameValid({ rolls: [7, 3, 10] }, 9)).toBe(true);
    expect(isFrameValid({ rolls: [7, 2, 5] }, 9)).toBe(false);
  });
  it('teljesség', () => {
    expect(isFrameComplete({ rolls: [10] }, 0)).toBe(true);
    expect(isFrameComplete({ rolls: [10, 10] }, 9)).toBe(false);
    expect(isFrameComplete({ rolls: [7, 2] }, 9)).toBe(true);
    expect(isGameComplete(F(...repeat([9, 0], 10)))).toBe(true);
    expect(isGameComplete(F(...repeat([9, 0], 9)))).toBe(false);
  });
});

describe('jelölések', () => {
  it('X, /, -, szám', () => {
    expect(frameMarks({ rolls: [10] })).toEqual(['X']);
    expect(frameMarks({ rolls: [7, 3] })).toEqual(['7', '/']);
    expect(frameMarks({ rolls: [0, 0] })).toEqual(['-', '-']);
    expect(frameMarks({ rolls: [10, 10, 10] })).toEqual(['X', 'X', 'X']);
    expect(frameMarks({ rolls: [10, 7, 3] })).toEqual(['X', '7', '/']);
    expect(frameMarks({ rolls: [8, 2, 10] })).toEqual(['8', '/', 'X']);
    expect(frameMarks({ rolls: [0, 10, 5] })).toEqual(['-', '/', '5']);
  });
});

describe('split felismerés', () => {
  it('klasszikus splitek', () => {
    for (const s of [[7, 10], [4, 6], [5, 7], [2, 7], [3, 10], [4, 9], [6, 7], [5, 10], [2, 4, 10]]) expect(isSplit(s)).toBe(true);
  });
  it('nem split', () => {
    for (const s of [[10], [3, 6, 10], [2, 4, 5], [2, 8], [3, 9], [1, 7], [4, 5], [6, 10]]) expect(isSplit(s)).toBe(false);
  });
});

describe('frame-statisztika', () => {
  it('strike, spare, nyitott frame', () => {
    // X | 7/ | 9- | X | -8 | 8/ | -6 | X | X | X81
    const st = addGameStats(emptyFrameStats(), F([10], [7, 3], [9, 0], [10], [0, 8], [8, 2], [0, 6], [10], [10], [10, 8, 1]));
    expect(st.games).toBe(1);
    // friss állások: 1–9. frame első dobása (9) + 10.: X, majd 8 (friss) = 11; strike: 4 + X a 10.-ben = 5
    expect(st.strikes).toBe(5);
    expect(st.strikeChances).toBe(11);
    // spare-kísérletek: 7/, 9-, -8, 8/, -6, és a 10.-ben 8→1 = 6; sikeres 2
    expect(st.spareChances).toBe(6);
    expect(st.spares).toBe(2);
    expect(st.opens).toBe(3); // 9-, -8, -6 (a 10. frame X-szel indul)
  });

  it('300-as játék: 12/12 strike, nincs spare-kísérlet', () => {
    const st = addGameStats(emptyFrameStats(), F(...repeat([10], 9), [10, 10, 10]));
    expect(st.strikes).toBe(12);
    expect(st.strikeChances).toBe(12);
    expect(st.spareChances).toBe(0);
    expect(st.opens).toBe(0);
  });

  it('10. frame nyitott', () => {
    const st = addGameStats(emptyFrameStats(), F(...repeat([10], 9), [7, 2]));
    expect(st.opens).toBe(1);
  });

  it('bábu-állások: split, egy bábu, sarokbábu', () => {
    const frames: Frame[] = [
      { rolls: [9, 1], pinsLeft: [10] },
      { rolls: [9, 0], pinsLeft: [10] },
      { rolls: [8, 0], pinsLeft: [7, 10] },
      { rolls: [8, 2], pinsLeft: [4, 6] },
      { rolls: [9, 1], pinsLeft: [7] },
      ...F(...repeat([10], 4)),
      { rolls: [10, 9, 0], pinsLeft: [10] },
    ];
    const st = addGameStats(emptyFrameStats(), frames, 10);
    expect(st.leavesKnown).toBe(6);
    expect(st.splits).toBe(2);
    expect(st.splitsConverted).toBe(1);
    expect(st.singlePinChances).toBe(4);
    expect(st.singlePinSpares).toBe(2);
    expect(st.cornerLeaves).toBe(3);
    expect(st.cornerSpares).toBe(1);
    expect(worstLeaves(st)[0]).toMatchObject({ key: '10', n: 3, made: 1, missed: 2 });
    // balkezesnél a 7-es a sarokbábu
    const left = addGameStats(emptyFrameStats(), frames, 7);
    expect(left.cornerLeaves).toBe(1);
  });

  it('ellentmondó ábrát nem használ', () => {
    const frames: Frame[] = [{ rolls: [8, 2], pinsLeft: [10] }, ...F(...repeat([0, 0], 9))];
    expect(addGameStats(emptyFrameStats(), frames).leavesKnown).toBe(0);
  });

  it('hiányos játékot kihagy', () => {
    expect(addGameStats(emptyFrameStats(), F([10], [7, 3])).games).toBe(0);
  });

  it('százalék', () => {
    expect(pct(1, 4)).toBe(25);
    expect(pct(1, 0)).toBeNull();
  });
});

describe('maradékbábu-térkép: bővített statisztika', async () => {
  const { leaveTable, avgFirstBall } = await import('../src/domain/scoring');
  const { fmtRate } = await import('../src/util/format');
  // 1: 9/ (10-es, Z) | 2: 9- (10-es, J) | 3: 8- (7-10, J) | 4: X | 5: 7/ (3-6-10, Z) | 6: 8/ (4-5, B) | 7–9: X | 10: X 9-
  const frames: Frame[] = [
    { rolls: [9, 1], pinsLeft: [10], firstBall: 'zseb' },
    { rolls: [9, 0], pinsLeft: [10], firstBall: 'jobb' },
    { rolls: [8, 0], pinsLeft: [7, 10], firstBall: 'jobb' },
    { rolls: [10] },
    { rolls: [7, 3], pinsLeft: [3, 6, 10], firstBall: 'zseb' },
    { rolls: [8, 2], pinsLeft: [4, 5], firstBall: 'bal' },
    { rolls: [10] }, { rolls: [10] }, { rolls: [10], firstBall: 'zseb' },
    { rolls: [10, 9, 0], pinsLeft: [10] },
  ];
  const st = addGameStats(emptyFrameStats(), frames, 10);

  it('egy- és többbábus állások külön', () => {
    expect(st.singlePinChances).toBe(3);
    expect(st.singlePinSpares).toBe(1);
    expect(st.multiPinChances).toBe(3);
    expect(st.multiPinSpares).toBe(2);
  });
  it('első dobás iránya: jelöltek, jelöletlen strike, jelöletlen egyéb', () => {
    expect(st.dir).toEqual({ zseb: 3, bal: 1, jobb: 2, strike: 4, none: 0 });
  });
  it('állások gyakoriság szerint, a legtöbb pinbe kerülő kiemelve', () => {
    const rows = leaveTable(st);
    expect(rows[0]).toMatchObject({ key: '10', n: 3, made: 1, missed: 2 });
    // első dobás átlaga: (9+9+8+10+7+8+10+10+10+10)/10 = 9,1; a 10-es kihagyásai: 2 bent maradt + 2 × 9,1 bónusz
    expect(avgFirstBall(st)).toBeCloseTo(9.1);
    expect(rows[0].lostPins).toBeCloseTo(2 + 2 * 9.1);
    expect(rows[0].worst).toBe(true);
    const split = rows.find((r) => r.key === '7-10')!;
    expect(split).toMatchObject({ split: true, missed: 1, worst: false });
    expect(split.lostPins).toBeCloseTo(2 + 9.1);
    expect(rows.filter((r) => r.worst)).toHaveLength(1);
  });
  it('kis mintánál nincs százalék', () => {
    expect(fmtRate(4, 9)).toBe('4/9');
    expect(fmtRate(7, 10)).toBe('70% (7/10)');
    expect(fmtRate(0, 0)).toBe('–');
  });
  it('a pontszám a frame-adatból (iránytól függetlenül)', () => {
    expect(scoreGame(frames).total).toBe(scoreGame(frames.map(({ rolls }) => ({ rolls }))).total);
  });
});

describe('csatorna után', () => {
  it('a teljes sor nem maradék állás, de spare-lehetőség', () => {
    const frames: Frame[] = [{ rolls: [0, 3], pinsLeft: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, ...Array.from({ length: 9 }, () => ({ rolls: [0, 0] }))];
    const st = addGameStats(emptyFrameStats(), frames);
    expect(st.spareChances).toBe(10);
    expect(st.leavesKnown).toBe(0);
    expect(st.multiPinChances).toBe(0);
    expect(st.leaves.size).toBe(0);
  });
});
