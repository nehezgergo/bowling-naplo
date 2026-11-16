import { describe, expect, it } from 'vitest';
import { ADVICE_SCHEMA, buildCoachMessage, estimateCostUsd, parseAdvice, SYSTEM_PROMPT } from '../src/coach/prompt';
import { emptyData, type AppData, type Session } from '../src/domain/types';
import { exportJson } from '../src/storage/io';
import { sampleReport } from './fixtures';

const s = (id: string, date: string, scores: number[], extra: Partial<Session> = {}): Session => ({
  id, date, type: 'edzes', ball: '12 lb', games: scores.map((score, i) => ({ index: i + 1, score })),
  createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`, ...extra,
});

const data = (): AppData => ({
  ...emptyData(),
  settings: { ...emptyData().settings, goalAverage: 150, profile: { hand: 'bal', style: 'egykezes', yearsPlaying: 2, longTermGoal: '160-as átlag' } },
  sessions: [
    s('a', '2026-09-01', [120, 130, 125]),
    s('b', '2026-10-01', [140, 150], { type: 'bajnoksag', eventName: 'Őszi liga', coach: { fatigue: 4, focusGoal: 'spare-ek', focusResult: 'nem', wentBad: 'a 7-es bábu' } }),
    s('c', '2026-10-20', [155, 160]),
  ],
});

describe('az edzőnek küldött üzenet', () => {
  const msg = buildCoachMessage(data(), '2026-11-16', 'Mire figyeljek szombaton?');

  it('tartalmazza a profilt, a célt és a kezességet', () => {
    expect(msg).toContain('balkezes');
    expect(msg).toContain('160-as átlag');
    expect(msg).toContain('célátlag: 150');
  });
  it('tartalmazza a statisztikát és a havi átlagokat', () => {
    expect(msg).toContain('7 játék, 3 alkalom');
    expect(msg).toContain('2026-10: 151.3'); // (140+150+155+160)/4 = 151,25
  });
  it('tartalmazza az alkalmak megjegyzéseit és a fókuszt', () => {
    expect(msg).toContain('Őszi liga');
    expect(msg).toContain('fáradtság 4/5');
    expect(msg).toContain('fókusz: „spare-ek” – nem sikerült');
    expect(msg).toContain('a 7-es bábu');
  });
  it('a legfrissebb alkalom van elöl', () => {
    expect(msg.indexOf('2026-10-20')).toBeLessThan(msg.indexOf('2026-09-01'));
  });
  it('a kérdés a végén', () => {
    expect(msg.trim().endsWith('Mire figyeljek szombaton?')).toBe(true);
  });
  it('kérdés nélkül átfogó elemzést kér', () => {
    expect(buildCoachMessage(data(), '2026-11-16')).toContain('átfogó elemzést');
  });
  it('a korábbi tanácsokat és az azóta történteket is elküldi', () => {
    const d = { ...data(), coachReports: [{ ...sampleReport, lastSessionDate: '2026-10-01' }] };
    const m = buildCoachMessage(d, '2026-11-16');
    expect(m).toContain('Korábbi tanácsaid');
    expect(m).toContain('10-es bábu – Keresztben, egyenesen.');
    expect(m).toContain('Azóta: 1 alkalom, 2 játék, átlag 157.5');
  });
  it('nem küld API-kulcsot vagy azonosítót', () => {
    expect(msg).not.toMatch(/sk-ant/);
    expect(msg).not.toContain('createdAt');
  });
});

describe('a válasz ellenőrzése', () => {
  it('helyes szerkezet', () => {
    expect(parseAdvice(JSON.stringify(sampleReport.advice))).toEqual(sampleReport.advice);
  });
  it('hiányos vagy hibás JSON: érthető hiba', () => {
    expect(() => parseAdvice('{"summary": "fél')).toThrow(/teljesen/);
    expect(() => parseAdvice(JSON.stringify({ ...sampleReport.advice, drills: [{ name: 'x' }] }))).toThrow(/formában/);
  });
  it('a séma minden mezőt kötelezővé tesz', () => {
    expect([...ADVICE_SCHEMA.required].sort()).toEqual(Object.keys(ADVICE_SCHEMA.properties).sort());
    expect(ADVICE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('egyéb', () => {
  it('költségbecslés (Opus 5.5: 4 $ / 20 $ millió tokenenként)', () => {
    expect(estimateCostUsd(1_000_000, 0)).toBe(4);
    expect(estimateCostUsd(5000, 2000)).toBeCloseTo(0.06);
  });
  it('a rendszerutasítás magyar választ kér', () => {
    expect(SYSTEM_PROMPT).toMatch(/Magyarul/);
  });
  it('az API-kulcs nem kerül a mentésbe', () => {
    expect(exportJson(data())).not.toMatch(/sk-ant|apiKey/i);
  });
});

describe('API-kulcs beillesztése', async () => {
  const { cleanKey } = await import('../src/coach/claude');
  it('eltávolítja a szóközt, sortörést, láthatatlan karaktert és idézőjelet', () => {
    expect(cleanKey('  sk-ant-api03-abc\n def​ ')).toBe('sk-ant-api03-abcdef');
    expect(cleanKey('"sk-ant-usr-xyz"')).toBe('sk-ant-usr-xyz');
    expect(cleanKey('„sk-ant-api03-q”')).toBe('sk-ant-api03-q');
  });
});
