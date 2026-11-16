import { afterEach, describe, expect, it } from 'vitest';
import { coachTips } from '../src/coach/rules';
import { dashboard } from '../src/domain/stats';
import {
  DEFAULT_SESSION_TYPES,
  defaultSettings,
  emptyData,
  setSessionTypes,
  typeKind,
  typeLabel,
  type AppData,
  type Session,
  type SessionTypeDef,
} from '../src/domain/types';
import { normalize, validTypes } from '../src/storage/db';
import { backupReminder, snoozeUntil } from '../src/storage/backup';
import { exportCsv, exportJson, guessKind, newTypeFromLabel, parseCsvImport, parseJsonImport, withNewTypes } from '../src/storage/io';

let n = 0;
const uid = () => `u${++n}`;
const s = (type: string, scores: number[], date = '2026-10-01', extra: Partial<Session> = {}): Session => ({
  id: `s${++n}`, date, type, games: scores.map((score, i) => ({ index: i + 1, score })),
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...extra,
});

const custom: SessionTypeDef[] = [
  { id: 'edzes', label: 'Edzés', kind: 'edzes' },
  { id: 'csb', label: 'Csapatbajnokság', kind: 'verseny' },
  { id: 'baráti', label: 'Baráti játék', kind: 'egyeb' },
];

afterEach(() => setSessionTypes(DEFAULT_SESSION_TYPES));

describe('saját típusok', () => {
  it('név és kategória a beállított listából', () => {
    setSessionTypes(custom);
    expect(typeLabel('csb')).toBe('Csapatbajnokság');
    expect(typeKind('csb')).toBe('verseny');
    expect(typeKind('baráti')).toBe('egyeb');
  });
  it('törölt típus: az alapértelmezett név, vagy maga az azonosító; kategória „egyéb”', () => {
    setSessionTypes(custom);
    expect(typeLabel('kupa')).toBe('Kupa');
    expect(typeKind('kupa')).toBe('verseny');
    expect(typeLabel('ismeretlen')).toBe('ismeretlen');
    expect(typeKind('ismeretlen')).toBe('egyeb');
  });
  it('az edzés- és versenyátlag a kategória szerint számol', () => {
    setSessionTypes(custom);
    const d = dashboard([s('edzes', [120]), s('csb', [150, 160]), s('baráti', [200])]);
    expect(d.trainingAvg).toBe(120);
    expect(d.competitionAvg).toBe(155);
  });
  it('egy edzés típusú saját kategória is edzésnek számít', () => {
    setSessionTypes([...custom, { id: 'reggeli', label: 'Reggeli gyakorlás', kind: 'edzes' }]);
    expect(dashboard([s('edzes', [100]), s('reggeli', [140])]).trainingAvg).toBe(120);
  });
  it('az edző is a kategóriát használja', () => {
    setSessionTypes(custom);
    const sessions = [s('edzes', [150, 150, 150, 150, 150, 150]), s('csb', [135, 140, 138, 140, 139, 140])];
    const tips = coachTips({ sessions, settings: { ...defaultSettings(), sessionTypes: custom }, today: '2026-10-02' });
    expect(tips.map((t) => t.id)).toContain('verseny-nyomas');
  });
});

describe('típuslista ellenőrzése és régi adatok', () => {
  it('hiányos elemeket és duplikátumot kiszűr', () => {
    expect(validTypes([{ id: 'a', label: 'A', kind: 'edzes' }, { id: 'a', label: 'B', kind: 'edzes' }, { id: 'c', label: ' ', kind: 'edzes' }, { id: 'd', label: 'D', kind: 'x' }]))
      .toEqual([{ id: 'a', label: 'A', kind: 'edzes' }]);
    expect(validTypes([])).toBeNull();
  });
  it('régi mentésben (típuslista nélkül) az alapértelmezett típusok jönnek', () => {
    const d = normalize({ sessions: [], settings: { balls: [] } });
    expect(d.settings.sessionTypes.map((t) => t.id)).toEqual(DEFAULT_SESSION_TYPES.map((t) => t.id));
  });
});

describe('import és saját típusok', () => {
  it('a kategóriát a névből becsli', () => {
    expect(guessKind('Edzés délután')).toBe('edzes');
    expect(guessKind('Csapatbajnokság')).toBe('verseny');
    expect(guessKind('Városi Torna')).toBe('verseny');
    expect(guessKind('Céges buli')).toBe('egyeb');
  });
  it('egyedi azonosítót ad', () => {
    expect(newTypeFromLabel('Kupa', DEFAULT_SESSION_TYPES)).toEqual({ id: 'kupa_2', label: 'Kupa', kind: 'verseny' });
  });
  it('CSV-ből az ismeretlen típusnevek új típusként jönnek, egyszer', () => {
    const res = parseCsvImport('Dátum;Típus;Pontszám\n2025-01-01;Csapatbajnokság;150\n2025-01-08;csapatbajnoksag;140\n2025-01-09;Edzés;130\n', uid);
    expect(res.newTypes).toEqual([{ id: 'csapatbajnoksag', label: 'Csapatbajnokság', kind: 'verseny' }]);
    expect(res.sessions.map((x) => x.type)).toEqual(['csapatbajnoksag', 'csapatbajnoksag', 'edzes']);
  });
  it('JSON-ból a fájl saját típusleírása jön át', () => {
    setSessionTypes(custom);
    const data: AppData = { ...emptyData(), settings: { ...defaultSettings(), sessionTypes: custom }, sessions: [s('csb', [150])] };
    const text = exportJson(data);
    setSessionTypes(DEFAULT_SESSION_TYPES);
    const res = parseJsonImport(text, uid);
    expect(res.newTypes).toEqual([{ id: 'csb', label: 'Csapatbajnokság', kind: 'verseny' }]);
  });
  it('a meglévő listát kiegészíti, nem írja felül', () => {
    const st = withNewTypes(defaultSettings(), [{ id: 'csb', label: 'Csapatbajnokság', kind: 'verseny' }, { id: 'kupa', label: 'Más', kind: 'egyeb' }]);
    expect(st.sessionTypes.length).toBe(DEFAULT_SESSION_TYPES.length + 1);
    expect(st.sessionTypes.find((t) => t.id === 'kupa')!.label).toBe('Kupa');
  });
  it('CSV export a saját típus nevét írja', () => {
    setSessionTypes(custom);
    expect(exportCsv([s('csb', [150])])).toContain(';Csapatbajnokság;');
  });
});

describe('mentési emlékeztető', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const data = (sessions: Session[], settings: Partial<AppData['settings']> = {}): AppData => ({ ...emptyData(), sessions, settings: { ...defaultSettings(), ...settings } });

  it('üres napló: nincs emlékeztető', () => {
    expect(backupReminder(data([]), now)).toBeNull();
  });
  it('még soha nem mentett: 5 alkalom után, vagy ha az első egy hétnél régebbi', () => {
    expect(backupReminder(data([s('edzes', [1], '2026-11-15')]), now)).toBeNull();
    expect(backupReminder(data([s('edzes', [1], '2026-11-01')]), now)).toEqual({ days: null, changed: 1 });
    expect(backupReminder(data(Array.from({ length: 5 }, () => s('edzes', [1], '2026-11-16'))), now)?.changed).toBe(5);
  });
  it('30 napnál régebbi mentés és azóta új alkalom', () => {
    const sessions = [s('edzes', [1], '2026-09-01'), s('edzes', [1], '2026-11-10')];
    expect(backupReminder(data(sessions, { lastExportAt: '2026-10-01T00:00:00.000Z' }), now)).toEqual({ days: 46, changed: 1 });
  });
  it('friss mentésnél, vagy ha azóta nem változott semmi: nincs', () => {
    const sessions = [s('edzes', [1], '2026-09-01')];
    expect(backupReminder(data(sessions, { lastExportAt: '2026-11-01T00:00:00.000Z' }), now)).toBeNull();
    expect(backupReminder(data(sessions, { lastExportAt: '2026-09-02T00:00:00.000Z' }), now)).toBeNull();
  });
  it('módosított régi alkalom is mentetlen változás', () => {
    const edited = s('edzes', [1], '2026-08-01', { updatedAt: '2026-11-05T00:00:00.000Z' });
    expect(backupReminder(data([edited], { lastExportAt: '2026-10-01T00:00:00.000Z' }), now)?.changed).toBe(1);
  });
  it('„Később”: egy hétig nem jelenik meg', () => {
    const sessions = [s('edzes', [1], '2026-11-01')];
    expect(backupReminder(data(sessions, { backupSnoozeUntil: snoozeUntil(now) }), now)).toBeNull();
    expect(backupReminder(data(sessions, { backupSnoozeUntil: snoozeUntil(now) }), new Date('2026-11-24T00:00:00.000Z'))).not.toBeNull();
  });
});
