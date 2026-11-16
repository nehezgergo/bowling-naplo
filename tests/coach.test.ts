import { describe, expect, it } from 'vitest';
import { coachTips, nextFocus, sessionFeedback, stdDev } from '../src/coach/rules';
import { defaultSettings, type Session, type SessionCoach, type SessionType } from '../src/domain/types';

let n = 0;
const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const mk = (i: number, type: SessionType, scores: number[], extra: Partial<Session> = {}): Session => ({
  id: `s${++n}`,
  date: day(i),
  type,
  games: scores.map((score, k) => ({ index: k + 1, score })),
  createdAt: `${day(i)}T10:00:00Z`,
  updatedAt: `${day(i)}T10:00:00Z`,
  ...extra,
});
const settings = { ...defaultSettings(), goalAverage: undefined };
const ids = (sessions: Session[], today = day(200)) =>
  coachTips({ sessions, settings, today: sessions.length ? sessions.at(-1)!.date : today }).map((t) => t.id);

describe('szórás', () => {
  it('minta-szórás', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stdDev([5])).toBeNull();
  });
});

describe('edzői szabályok', () => {
  it('kevés adatnál nincs tipp', () => {
    expect(ids([mk(0, 'edzes', [150, 160])])).toEqual([]);
  });

  it('emelkedő és eső forma', () => {
    const up = [mk(0, 'edzes', Array(20).fill(120)), mk(1, 'edzes', Array(20).fill(130))];
    expect(ids(up)).toContain('forma-fel');
    const down = [mk(0, 'edzes', Array(20).fill(130)), mk(1, 'edzes', Array(20).fill(120))];
    expect(ids(down)).toContain('forma-le');
    const flat = [mk(0, 'edzes', Array(20).fill(125)), mk(1, 'edzes', Array(20).fill(127))];
    expect(ids(flat)).not.toContain('forma-fel');
    expect(ids(flat)).not.toContain('forma-le');
  });

  it('versenyen gyengébb, mint edzésen', () => {
    const s = [mk(0, 'edzes', [150, 150, 150, 150, 150, 150]), mk(1, 'bajnoksag', [135, 140, 138, 140, 139, 140])];
    const tips = coachTips({ sessions: s, settings, today: day(1) });
    expect(tips.map((t) => t.id)).toContain('verseny-nyomas');
    expect(nextFocus(tips)?.id).toBe('verseny-nyomas');
  });

  it('nagy szórás és sok 100 alatti játék', () => {
    const s = [mk(0, 'edzes', [80, 180, 90, 170, 85, 175, 95, 165, 88, 172])];
    const got = ids(s);
    expect(got).toContain('szoras-nagy');
    expect(got).toContain('bukasok');
  });

  it('lassú kezdés vs. fáradás', () => {
    const slow = [0, 1, 2, 3].map((i) => mk(i, 'edzes', [110, 135, 135]));
    expect(ids(slow)).toContain('bemelegites');
    const tired = [0, 1, 2, 3].map((i) => mk(i, 'edzes', [145, 140, 125]));
    expect(ids(tired)).toContain('kitartas');
  });

  it('golyók összevetése csak elég játéknál', () => {
    const s = [mk(0, 'edzes', Array(10).fill(150), { ball: '12 lb' }), mk(1, 'edzes', Array(10).fill(130), { ball: '11 lb' })];
    const tip = coachTips({ sessions: s, settings, today: day(1) }).find((t) => t.id === 'golyo');
    expect(tip?.title).toContain('12 lb');
    const few = [mk(0, 'edzes', Array(9).fill(150), { ball: '12 lb' }), mk(1, 'edzes', Array(10).fill(130), { ball: '11 lb' })];
    expect(ids(few)).not.toContain('golyo');
  });

  it('fáradtság hatása az alkalmankénti mezőkből', () => {
    const c = (fatigue: SessionCoach['fatigue']) => ({ coach: { fatigue } });
    const s = [
      ...[0, 1, 2].map((i) => mk(i, 'edzes', [150, 150], c(1))),
      ...[3, 4, 5].map((i) => mk(i, 'edzes', [130, 130], c(5))),
    ];
    expect(ids(s)).toContain('faradtsag');
  });

  it('hosszú kihagyás', () => {
    const s = [mk(0, 'edzes', [150, 150, 150])];
    expect(coachTips({ sessions: s, settings, today: day(30) }).map((t) => t.id)).toContain('szunet');
    expect(coachTips({ sessions: s, settings, today: day(10) }).map((t) => t.id)).not.toContain('szunet');
  });

  it('cél közel és elérve', () => {
    const s = [mk(0, 'edzes', Array(10).fill(145))];
    expect(coachTips({ sessions: s, settings: { ...settings, goalAverage: 150 }, today: day(0) }).map((t) => t.id)).toContain('cel-kozel');
    expect(coachTips({ sessions: s, settings: { ...settings, goalAverage: 140 }, today: day(0) }).map((t) => t.id)).toContain('cel-elerve');
  });

  it('balkezesnél tükrözött oldalak a spare-tanácsban', () => {
    const s = [mk(0, 'edzes', [80, 180, 90, 170, 85, 175, 95, 165, 88, 172])];
    const tip = coachTips({ sessions: s, settings: { ...settings, profile: { hand: 'bal' } }, today: day(0) }).find((t) => t.id === 'bukasok')!;
    expect(tip.drill).toContain('7-es');
    expect(tip.drill).toContain('balra');
  });

  it('fontossági sorrend', () => {
    const s = [mk(0, 'edzes', [80, 180, 90, 170, 85, 175, 95, 165, 88, 172])];
    const tips = coachTips({ sessions: s, settings, today: day(0) });
    for (let i = 1; i < tips.length; i++) expect(tips[i - 1].priority).toBeGreaterThanOrEqual(tips[i].priority);
  });
});

describe('frame-alapú szabályok', () => {
  const Fr = (rolls: number[], pinsLeft?: number[]) => ({ rolls, pinsLeft });
  /** 9 frame egy bábus (10-es) állással, ebből `made` leütve, + egy strike-os 10. frame. */
  const game = (made: number) => [
    ...Array.from({ length: 9 }, (_, i) => (i < made ? Fr([9, 1], [10]) : Fr([9, 0], [10]))),
    Fr([10, 10, 10]),
  ];
  const withFrames = (made: number, k: number) =>
    mk(k, 'edzes', [0], { games: [{ index: 1, score: 0, frames: game(made) }] });

  it('gyenge egy bábus és sarokbábu spare', () => {
    const s = [withFrames(3, 0), withFrames(3, 1), withFrames(3, 2)];
    const got = ids(s);
    expect(got).toContain('egybabu');
    expect(got).toContain('sarokbabu');
    expect(got).not.toContain('spare-arany'); // az egy bábus tipp lefedi
  });

  it('jó spare-arány mellett nincs figyelmeztetés', () => {
    const s = [withFrames(9, 0), withFrames(9, 1), withFrames(8, 2)];
    const got = ids(s);
    expect(got).not.toContain('egybabu');
    expect(got).not.toContain('sarokbabu');
  });

  it('kevés részletes játéknál nincs frame-tipp', () => {
    expect(ids([withFrames(0, 0), withFrames(0, 1)])).not.toContain('egybabu');
  });

  it('a visszajelzés megemlíti a frame-adatot', () => {
    const s = withFrames(5, 0);
    expect(sessionFeedback(s, [s]).lines.join(' ')).toContain('spare 5/9');
  });
});

describe('mentés utáni visszajelzés', () => {
  it('első alkalom', () => {
    const s = mk(0, 'edzes', [120, 130]);
    expect(sessionFeedback(s, [s]).lines[0]).toContain('első');
  });

  it('új egyéni csúcs és jobb az átlagnál', () => {
    const old = mk(0, 'edzes', [120, 125, 130, 120, 125]);
    const now = mk(1, 'edzes', [160, 140]);
    const fb = sessionFeedback(now, [old, now]);
    expect(fb.headline).toContain('160');
    expect(fb.level).toBe('jo');
    expect(fb.lines[0]).toContain('jobb');
  });

  it('a későbbi alkalmak nem számítanak bele a viszonyításba', () => {
    const now = mk(0, 'edzes', [130, 130]);
    const later = mk(5, 'edzes', [200, 200, 200, 200, 200]);
    const fb = sessionFeedback(now, [now, later]);
    expect(fb.lines[0]).toContain('első');
  });

  it('nem jelez esést, ha a későbbi játékok is a szokásos szint fölött vannak', () => {
    const old = mk(0, 'edzes', [130, 130, 130, 130, 130]);
    const now = mk(1, 'edzes', [175, 150, 152]);
    expect(sessionFeedback(now, [old, now]).lines.join(' ')).not.toContain('visszaestél');
    const bad = mk(2, 'edzes', [150, 120, 118]);
    expect(sessionFeedback(bad, [old, bad]).lines.join(' ')).toContain('visszaestél');
  });

  it('gyenge első játék jelzése', () => {
    const now = mk(0, 'edzes', [100, 140, 145]);
    expect(sessionFeedback(now, [now]).lines.join(' ')).toContain('első játék');
  });
});
