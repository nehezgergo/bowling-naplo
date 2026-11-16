import { describe, expect, it } from 'vitest';
import { defaultSettings, type AppData, type Frame, type Session } from '../src/domain/types';
import {
  csvTemplate,
  exportCsv,
  exportJson,
  mergeReports,
  mergeSessions,
  parseCsvImport,
  parseCsvRows,
  parseDate,
  parseImport,
  parseJsonImport,
  parseType,
  summarizeImport,
} from '../src/storage/io';
import { sampleReport } from './fixtures';

let k = 0;
const uid = () => `gen-${++k}`;

const tenFrames: Frame[] = [
  { rolls: [10] }, { rolls: [9, 1], pinsLeft: [10], pinsAfter: [] }, { rolls: [8, 0], pinsLeft: [7, 10], pinsAfter: [7, 10] },
  { rolls: [10] }, { rolls: [8, 2], pinsLeft: [6, 10], pinsAfter: [] }, { rolls: [9, 0], pinsLeft: [10], pinsAfter: [10] },
  { rolls: [10] }, { rolls: [10] }, { rolls: [10] }, { rolls: [10, 9, 1], pinsLeft: [10], pinsAfter: [] },
];

const sample = (): AppData => ({
  schemaVersion: 1,
  coachReports: [sampleReport],
  settings: { ...defaultSettings(), goalAverage: 160, profile: { hand: 'jobb', yearsPlaying: 3 } },
  sessions: [
    {
      id: 'a1', date: '2026-10-01', type: 'edzes', ball: '12 lb', venue: 'Gutenberg', note: 'jó; "nagyon" jó\nmásodik sor',
      coach: { fatigue: 2, concentration: 4, selfRating: 3, oil: 'kozepes', laneCondition: 'normal', lanes: '5–6', target: '2. nyíl', focusGoal: 'spare-ek', focusResult: 'reszben', wentWell: 'tempó', wentBad: '10-es' },
      games: [{ index: 1, score: 203, frames: tenFrames }, { index: 2, score: 151, ball: 'Spare golyó' }],
      createdAt: '2026-10-01T18:00:00.000Z', updatedAt: '2026-10-01T19:00:00.000Z',
    },
    {
      id: 'a2', date: '2026-10-05', type: 'legerosebb_lancszem', eventName: 'Őszi kör', ball: '11 lb',
      competition: { ownRank: 3, entrants: 12, teamName: 'Gurulók', teamRank: 2, teamsCount: 6 },
      games: [{ index: 1, score: 140 }, { index: 2, score: 0 }, { index: 3, score: 300 }],
      createdAt: '2026-10-05T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z',
    },
  ],
});

describe('JSON', () => {
  it('export → import pontosan ugyanazt adja vissza (frame-ekkel együtt)', () => {
    const data = sample();
    const res = parseJsonImport(exportJson(data), uid);
    expect(res.warnings).toEqual([]);
    expect(res.sessions).toEqual(data.sessions);
    expect(res.settings).toEqual(data.settings);
    expect(res.coachReports).toEqual(data.coachReports);
  });

  it('hiányos edzői elemzést kihagy', () => {
    const text = JSON.stringify({ sessions: [], coachReports: [sampleReport, { id: 'x', createdAt: 'c', advice: { summary: 'csak ennyi' } }] });
    const res = parseJsonImport(text, uid);
    expect(res.coachReports.map((r) => r.id)).toEqual(['r1']);
    expect(res.warnings[0]).toMatch(/edzői/);
  });

  it('edzőnapló összefésülése azonosító szerint', () => {
    expect(mergeReports([sampleReport], [sampleReport, { ...sampleReport, id: 'r2' }]).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('hibás tartalom: érthető hibaüzenet', () => {
    expect(() => parseJsonImport('nem json', uid)).toThrow(/JSON/);
    expect(() => parseJsonImport('{"a":1}', uid)).toThrow(/sessions/);
  });

  it('hibás játékokat és alkalmakat kihagy, figyelmeztet', () => {
    const text = JSON.stringify({
      sessions: [
        { id: 'x', date: '2026-01-01', type: 'edzes', games: [{ score: 150 }, { score: 333 }], createdAt: 'c', updatedAt: 'u' },
        { id: 'y', date: 'tegnap', type: 'edzes', games: [{ score: 150 }] },
        { id: 'z', date: '2026-01-02', type: 'valami', games: [{ score: 120 }] },
      ],
    });
    const res = parseJsonImport(text, uid);
    expect(res.sessions.map((s) => s.id)).toEqual(['x', 'z']);
    expect(res.sessions[0].games).toEqual([{ index: 1, score: 150 }]);
    expect(res.sessions[1].type).toBe('valami'); // ismeretlen típus: új típusként jön
    expect(res.newTypes).toEqual([{ id: 'valami', label: 'valami', kind: 'egyeb' }]);
    expect(res.warnings).toHaveLength(2);
  });

  it('a pontszámmal nem egyező frame-adatot eldobja', () => {
    const text = JSON.stringify({ sessions: [{ id: 'f', date: '2026-01-01', type: 'edzes', games: [{ score: 150, frames: tenFrames }] }] });
    const res = parseJsonImport(text, uid);
    expect(res.sessions[0].games[0].frames).toBeUndefined();
    expect(res.warnings[0]).toMatch(/frame/);
  });
});

describe('CSV export', () => {
  const csv = exportCsv(sample().sessions);
  it('UTF-8 BOM, pontosvessző, játékonként egy sor', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1 + 5);
    expect(rows[0][0]).toBe('Dátum');
    expect(rows[1].slice(0, 2)).toEqual(['2026-10-01', 'Edzés']);
  });
  it('idézőjeles mezők (pontosvessző, idézőjel, sortörés)', () => {
    const rows = parseCsvRows(csv);
    const noteCol = rows[0].indexOf('Megjegyzés');
    expect(rows[1][noteCol]).toBe('jó; "nagyon" jó\nmásodik sor');
  });
  it('export → import: minden adat visszajön, a frame-részletek kivételével', () => {
    const res = parseCsvImport(csv, uid);
    expect(res.warnings).toEqual([]);
    const strip = (s: Session) => ({ ...s, createdAt: '', updatedAt: '', games: s.games.map(({ frames: _f, ...g }) => g) });
    expect(res.sessions.map(strip)).toEqual(sample().sessions.map(strip));
  });
});

describe('CSV import: korábbi eredmények', () => {
  it('a minta betölthető', () => {
    const res = parseCsvImport(csvTemplate(), uid);
    expect(res.sessions).toHaveLength(2);
    expect(res.sessions[0]).toMatchObject({ date: '2025-09-12', type: 'edzes', venue: 'Gutenberg', ball: '12 lb' });
    expect(res.sessions[0].games.map((g) => g.score)).toEqual([134, 151]);
    expect(res.sessions[1]).toMatchObject({ type: 'bajnoksag', eventName: 'Őszi liga 1. forduló' });
  });

  it('széles formátum, vesszővel, magyar dátummal, ékezet nélküli fejléccel', () => {
    const text = 'datum,tipus,1. jatek,2. jatek,3. jatek\n2025.03.14.,edzes,120,135,\n2025. 03. 20.,Kupa,140,128,150\n';
    const res = parseCsvImport(text, uid);
    expect(res.sessions.map((s) => [s.date, s.type, s.games.map((g) => g.score)])).toEqual([
      ['2025-03-14', 'edzes', [120, 135]],
      ['2025-03-20', 'kupa', [140, 128, 150]],
    ]);
  });

  it('pontszám oszlop nélkül, csak számozott oszlopokkal (J1, J2)', () => {
    const res = parseCsvImport('Dátum;J1;J2\n14.03.2025;99;101\n', uid);
    expect(res.sessions[0].games.map((g) => g.score)).toEqual([99, 101]);
  });

  it('hosszú formátumban a sorszám adja a sorrendet', () => {
    const res = parseCsvImport('Dátum;Játék;Pontszám\n2025-01-01;2;150\n2025-01-01;1;120\n', uid);
    expect(res.sessions[0].games).toEqual([{ index: 1, score: 120 }, { index: 2, score: 150 }]);
  });

  it('hibás sorok figyelmeztetéssel kimaradnak', () => {
    const res = parseCsvImport('Dátum;Típus;Pontszám\nrossz;Edzés;150\n2025-01-01;Valami;150\n2025-01-02;Edzés;350\n', uid);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0].type).toBe('valami');
    expect(res.newTypes).toEqual([{ id: 'valami', label: 'Valami', kind: 'egyeb' }]);
    expect(res.warnings).toHaveLength(3); // dátum, pontszám, üres alkalom
  });

  it('hiányzó kötelező oszlop: érthető hiba', () => {
    expect(() => parseCsvImport('Pontszám\n150\n', uid)).toThrow(/dátum/);
    expect(() => parseCsvImport('Dátum;Megjegyzés\n2025-01-01;x\n', uid)).toThrow(/pontszám/i);
  });

  it('formátum felismerése', () => {
    expect(parseImport('mentes.json', exportJson(sample()), uid).format).toBe('json');
    expect(parseImport('adat.csv', csvTemplate(), uid).format).toBe('csv');
  });
});

describe('segédfüggvények', () => {
  it('dátumok', () => {
    expect(parseDate('2025-09-12')).toBe('2025-09-12');
    expect(parseDate('2025.9.2.')).toBe('2025-09-02');
    expect(parseDate('2025. 09. 12.')).toBe('2025-09-12');
    expect(parseDate('12.09.2025')).toBe('2025-09-12');
    expect(parseDate('2025/9/12')).toBe('2025-09-12');
    expect(parseDate('45000')).toBe('2023-03-15');
    expect(parseDate('2025-02-30')).toBeNull();
    expect(parseDate('tegnap')).toBeNull();
  });
  it('típusok', () => {
    expect(parseType('Edzés')).toBe('edzes');
    expect(parseType('LEGERŐSEBB LÁNCSZEM')).toBe('legerosebb_lancszem');
    expect(parseType('hivatal kupa')).toBe('hivatal_kupa');
    expect(parseType('Liga')).toBe('bajnoksag');
    expect(parseType('verseny')).toBeNull(); // nem létező típus: az import újként veszi fel
    expect(parseType('xyz')).toBeNull();
  });
});

describe('összefésülés', () => {
  const base = sample().sessions;
  it('azonos azonosítónál a frissebb marad', () => {
    const newer = { ...base[0], note: 'új', updatedAt: '2026-12-01T00:00:00.000Z' };
    const older = { ...base[1], note: 'régi', updatedAt: '2020-01-01T00:00:00.000Z' };
    const r = mergeSessions(base, [newer, older]);
    expect(r).toMatchObject({ added: 0, updated: 1, skipped: 1 });
    expect(r.sessions.find((s) => s.id === 'a1')!.note).toBe('új');
    expect(r.sessions.find((s) => s.id === 'a2')!.note).toBeUndefined();
  });
  it('azonosító nélküli duplikátumot kihagy, az újat hozzáadja', () => {
    const dup = { ...base[1], id: 'other' };
    const fresh: Session = { ...base[1], id: 'new', date: '2026-11-01' };
    const r = mergeSessions(base, [dup, fresh]);
    expect(r).toMatchObject({ added: 1, updated: 0, skipped: 1 });
    expect(r.sessions).toHaveLength(3);
  });
  it('ugyanaz az import kétszer nem duplikál', () => {
    const imp = parseCsvImport(csvTemplate(), uid).sessions;
    const once = mergeSessions([], imp).sessions;
    const again = parseCsvImport(csvTemplate(), uid).sessions;
    const twice = mergeSessions(once, again);
    expect(twice.added).toBe(0);
    expect(twice.sessions).toHaveLength(once.length);
  });
  it('összegzés', () => {
    expect(summarizeImport(base)).toEqual({ sessions: 2, games: 5, from: '2026-10-01', to: '2026-10-05', withFrames: 1 });
  });
});
