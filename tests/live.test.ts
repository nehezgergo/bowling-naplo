import { describe, expect, it } from 'vitest';
import { buildLiveMessage, LIVE_SCHEMA, LIVE_SYSTEM, parseLive, type LiveContext } from '../src/coach/live';
import { SYSTEM_PROMPT } from '../src/coach/prompt';
import { emptyData } from '../src/domain/types';
import { explain, TERMS } from '../src/ui/glossary';

const ctx: LiveContext = { type: 'edzes', ball: '12 lb', coach: { oil: 'kozepes', lanes: '5' }, games: [{ no: 1, score: 141 }] };

describe('játék közbeni tanács', () => {
  it('a második dobásnál elküldi az álló bábukat és az eddigi köröket', () => {
    const m = buildLiveMessage(emptyData(), ctx, { no: 2, frames: [{ rolls: [9, 0], pinsLeft: [10], pinsAfter: [10], firstBall: 'jobb' }, { rolls: [8] }], standing: [6, 10] });
    expect(m).toContain('1. kör: 9 - (első dobás: jobbra ment; első után maradt: 10; második után maradt: 10)');
    expect(m).toContain('ezek a bábuk állnak: 6, 10');
    expect(m).toContain('1. játék: 141 pont');
    expect(m).toContain('olajozás: közepes');
  });
  it('új körnél és új játéknál más a kérdés', () => {
    expect(buildLiveMessage(emptyData(), ctx, { no: 2, frames: [{ rolls: [10] }] })).toContain('új kör első dobása');
    expect(buildLiveMessage(emptyData(), ctx)).toContain('Új játék következik');
  });
  it('a válasz ellenőrzése', () => {
    const ok = { now: 'Állj balra.', why: 'Mert.', steps: ['a'] };
    expect(parseLive(JSON.stringify(ok))).toEqual(ok);
    expect(() => parseLive('{"now":')).toThrow(/teljesen/);
    expect(() => parseLive('{"now":"a"}')).toThrow(/formában/);
    expect([...LIVE_SCHEMA.required]).toEqual(Object.keys(LIVE_SCHEMA.properties));
  });
  it('mindkét edzőnek előírjuk a közérthető fogalmazást', () => {
    for (const p of [LIVE_SYSTEM, SYSTEM_PROMPT]) expect(p).toContain('KEZDŐ');
  });
});

describe('szótár', () => {
  it('a ragozott szakszó koppintható, szövegenként egyszer', () => {
    const h = explain('Kevés a spare-ed, a spare fontos. Célozz a zsebbe.');
    expect(h.match(/data-term="spare"/g)).toHaveLength(1);
    expect(h).toContain('data-term="zseb">zsebbe</button>');
  });
  it('a szöveg escape-elve marad', () => {
    expect(explain('<b>strike</b>')).toBe('&lt;b&gt;<button type="button" class="term" data-term="strike">strike</button>&lt;/b&gt;');
  });
  it('minden szónak van magyarázata, egyedi azonosítóval', () => {
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
    expect(TERMS.every((t) => t.text.length > 20)).toBe(true);
  });
});
