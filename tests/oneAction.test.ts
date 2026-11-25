import { describe, expect, it } from 'vitest';
import { oneAction } from '../src/coach/oneAction';
import { emptyData, type Frame, type Session } from '../src/domain/types';
import { applySeeds } from '../src/storage/seeds';

let n = 0;
const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const sess = (type: string, games: { score: number; frames?: Frame[] }[], i: number): Session => ({
  id: `s${++n}`, date: day(i), type, games: games.map((g, k) => ({ index: k + 1, ...g })),
  createdAt: `${day(i)}T10:00:00.000Z`, updatedAt: `${day(i)}T10:00:00.000Z`,
});

/** Egy teljes játék: az első frame megadható, a többi 9 frame „9-” (ismeretlen állással). */
const game = (first: Frame, rest: Frame = { rolls: [9, 0] }): { score: number; frames: Frame[] } => {
  const frames = [first, ...Array.from({ length: 9 }, () => ({ ...rest, rolls: [...rest.rolls] }))];
  // A 10. frame-ben spare vagy strike után jár a bónuszdobás.
  const last = frames[9];
  if (last.rolls[0] === 10 || last.rolls[0] + (last.rolls[1] ?? 0) === 10) last.rolls = [...last.rolls, 0];
  return { score: 0, frames };
};

/** 20 frame-adatos edzésjáték: a 10-es bábu 11-szer maradt, ebből 3-szor leütve. */
const tenPinGames = () =>
  Array.from({ length: 20 }, (_, i) =>
    sess('edzes', [i < 11 ? game({ rolls: [9, i < 3 ? 1 : 0], pinsLeft: [10] }) : game({ rolls: [9, 0] })], i),
  );

describe('egy teendő: a szabályok', () => {
  it('hidegindítás a kezdő adatokból (128,3 vs 140,7; 7 verseny)', () => {
    const a = oneAction(applySeeds(emptyData()).data.sessions);
    expect(a.id).toBe('hidegindulas');
    expect(a.text).toMatch(/12 ponttal gyengébb/);
    expect(a.source).toBe('1. játék 128,3, később 140,7 (7 verseny, ebből 5-ször jobb a 2.)');
    expect(a.lossPerGame).toBeCloseTo((985 - 898) / 7 / 2);
  });

  it('hidegindítás csak 8 pin hátránytól és 5 alkalomtól', () => {
    const small = [0, 1, 2, 3, 4].map((i) => sess('kupa', [{ score: 133 }, { score: 140 }], i)); // 7 pin
    expect(oneAction(small).id).not.toBe('hidegindulas');
    const few = [0, 1, 2, 3].map((i) => sess('kupa', [{ score: 120 }, { score: 140 }], i)); // csak 4 alkalom
    expect(oneAction(few).id).not.toBe('hidegindulas');
  });

  it('a legtöbb pinbe kerülő spare-állás, ellenőrizhető forrással', () => {
    const a = oneAction(tenPinGames());
    expect(a.id).toBe('spare');
    expect(a.text).toMatch(/10-es bábut/);
    expect(a.source).toMatch(/^10-es bábu: 3\/11 az utolsó 20 játékban/);
    // 8 kihagyás × (1 bent maradt + 9 pin elmaradt bónusz) / 20 játék = 4 pin/játék
    expect(a.lossPerGame).toBeCloseTo(4);
  });

  it('balkezesnél a 7-es a sarokbábu, a jobb szélről', () => {
    const games = Array.from({ length: 5 }, (_, i) => sess('edzes', [game({ rolls: [9, 0], pinsLeft: [7] })], i));
    const a = oneAction(games, { hand: 'bal' });
    expect(a.text).toMatch(/7-es bábut: a pálya jobb széléről/);
  });

  it('az első dobás szisztematikus oldalra húzása (legalább 60%, legalább 8 tévesztés)', () => {
    // minden játékban: 1. frame jobbra ment (7-) , a többi zseb-strike-szerű 9/
    const mk = (dir: 'jobb' | 'bal', i: number) =>
      sess('edzes', [game({ rolls: [7, 0], firstBall: dir }, { rolls: [9, 1], firstBall: 'zseb' })], i);
    const right = [...Array.from({ length: 7 }, (_, i) => mk('jobb', i)), ...Array.from({ length: 3 }, (_, i) => mk('bal', 10 + i))];
    const a = oneAction(right);
    expect(a.id).toBe('iranyzes');
    expect(a.text).toMatch(/jobbra megy/);
    expect(a.source).toMatch(/^első dobás: 10 tévesztésből 7 jobbra az utolsó 10 játékban/);
    expect(a.lossPerGame).toBeGreaterThan(0);
    const even = [...Array.from({ length: 5 }, (_, i) => mk('jobb', i)), ...Array.from({ length: 5 }, (_, i) => mk('bal', 10 + i))];
    expect(oneAction(even).id).not.toBe('iranyzes');
  });

  it('edzés–verseny különbség (legalább 5 pin, mindkét oldalon 6 játék)', () => {
    const s = [sess('edzes', Array(6).fill({ score: 150 }), 0), sess('kupa', Array(6).fill({ score: 140 }), 1)];
    const a = oneAction(s);
    expect(a.id).toBe('verseny');
    expect(a.source).toBe('edzés 150,0 (6 játék), verseny 140,0 (6 játék)');
    expect(a.lossPerGame).toBe(10);
    expect(oneAction([sess('edzes', Array(6).fill({ score: 144 }), 0), sess('kupa', Array(6).fill({ score: 140 }), 1)]).id).not.toBe('verseny');
  });
});

describe('egy teendő: prioritás és adathiány', () => {
  it('a nagyobb becsült veszteség nyer: hidegindítás (6,2) > 10-es bábu (4,0)', () => {
    const both = [...applySeeds(emptyData()).data.sessions, ...tenPinGames()];
    expect(oneAction(both).id).toBe('hidegindulas');
  });
  it('… és fordítva: ha a spare drágább, az nyer', () => {
    // 20 játék, mind kihagyott 10-es: 20 × 10 / 20 = 10 pin/játék
    const costly = Array.from({ length: 20 }, (_, i) => sess('edzes', [game({ rolls: [9, 0], pinsLeft: [10] })], 100 + i));
    expect(oneAction([...applySeeds(emptyData()).data.sessions, ...costly]).id).toBe('spare');
  });
  it('nincs adat: frame-enkénti rögzítést kér', () => {
    const a = oneAction([]);
    expect(a).toMatchObject({ id: 'adat', lossPerGame: null });
    expect(a.text).toMatch(/3 játékot dobásonként/);
    expect(a.source).toBe('0 dobásonként rögzített játék van (legalább 3 kell)');
  });
  it('van frame-adat, de nincs irány-jelölés: azt kéri', () => {
    const s = Array.from({ length: 3 }, (_, i) => sess('edzes', [game({ rolls: [9, 1] }, { rolls: [9, 1] })], i));
    expect(oneAction(s).text).toMatch(/első dobás irányát/);
  });
  it('mindig egyetlen mondat, forrással', () => {
    for (const s of [[], tenPinGames(), applySeeds(emptyData()).data.sessions]) {
      const a = oneAction(s);
      expect(a.text.trim().endsWith('.')).toBe(true);
      expect(a.text.split(/\.\s+[A-ZÁÉÍÓÖŐÚÜŰ]/).length).toBe(1);
      expect(a.source.length).toBeGreaterThan(5);
    }
  });
});

describe('magyar -szor/-szer/-ször rag', async () => {
  const { times } = await import('../src/util/format');
  it('a hangrend szerint', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(times)).toEqual(['1-szer', '2-szer', '3-szor', '4-szer', '5-ször', '6-szor', '7-szer', '8-szor', '9-szer']);
    expect([10, 20, 30, 40, 50, 60, 70, 80, 90].map(times)).toEqual(['10-szer', '20-szor', '30-szor', '40-szer', '50-szer', '60-szor', '70-szer', '80-szor', '90-szer']);
    expect([0, 11, 15, 25, 100, 1000].map(times)).toEqual(['0-szor', '11-szer', '15-ször', '25-ször', '100-szor', '1000-szer']);
  });
});
