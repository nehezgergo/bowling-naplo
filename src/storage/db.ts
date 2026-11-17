import { CURRENT_SCHEMA, emptyData, defaultSettings, type AppData, type Cutoff, type FieldBenchmark, type SessionTypeDef } from '../domain/types';

const DB_NAME = 'bowling-naplo';
const STORE = 'kv';
const KEY = 'data';
const LS_KEY = 'bowling-naplo-data';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(value: AppData): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const KINDS = new Set(['edzes', 'verseny', 'egyeb']);

/** Mezőny-határok ellenőrzése: csak a hiánytalan elemek maradnak. */
export function validBenchmarks(raw: unknown): FieldBenchmark[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is FieldBenchmark =>
    !!b && typeof b.id === 'string' && typeof b.series === 'string' && typeof b.event === 'string' &&
    (b.category === 'egyeni' || b.category === 'csapat') && Number.isInteger(b.qualifyRank) && b.qualifyRank > 0 &&
    Array.isArray(b.cutoffs) && b.cutoffs.every((c: Cutoff) => Number.isInteger(c?.rank) && c.rank > 0 && Number.isFinite(c?.total)),
  ).map((b) => ({ ...b, cutoffs: [...b.cutoffs].sort((x, y) => x.rank - y.rank) }));
}

/** A típuslista ellenőrzése: csak a hiánytalan elemek maradnak; üres lista helyett null. */
export function validTypes(raw: unknown): SessionTypeDef[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out = raw.filter((t): t is SessionTypeDef => {
    const ok = t && typeof t.id === 'string' && t.id && typeof t.label === 'string' && t.label.trim() && KINDS.has(t.kind) && !seen.has(t.id);
    if (ok) seen.add(t.id);
    return !!ok;
  });
  return out.length ? out : null;
}

/**
 * Migráció a régebbi verziókról. Csak hozzáad, soha nem töröl adatot:
 * - v1 → v2: új, opcionális mezők (bemelegítés, első dobás iránya, kezdő adatok jelölése);
 *   a meglévő alkalmak, beállítások és az edzőnapló változatlanok.
 */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  let out = { ...raw };
  if (v < 2) {
    out = { ...out, appliedSeeds: Array.isArray(out.appliedSeeds) ? out.appliedSeeds : [] };
    v = 2;
  }
  return { ...out, schemaVersion: v };
}

/** Hiányzó mezők pótlása régebbi/hiányos adatnál (a migráció után). */
export function normalize(raw: unknown): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const r = migrate(raw as Record<string, unknown>) as Partial<AppData>;
  return {
    schemaVersion: CURRENT_SCHEMA,
    appliedSeeds: Array.isArray(r.appliedSeeds) ? r.appliedSeeds.filter((x): x is string => typeof x === 'string') : [],
    benchmarks: validBenchmarks(r.benchmarks),
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    settings: {
      ...defaultSettings(),
      ...(r.settings ?? {}),
      profile: { ...(r.settings?.profile ?? {}) },
      sessionTypes: validTypes(r.settings?.sessionTypes) ?? defaultSettings().sessionTypes,
    },
    coachReports: Array.isArray(r.coachReports) ? r.coachReports : [],
  };
}

export async function load(): Promise<AppData> {
  try {
    const v = await idbGet();
    if (v) return normalize(v);
  } catch {
    /* IndexedDB nem érhető el: localStorage tartalék */
  }
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return normalize(JSON.parse(s));
  } catch {
    /* üres indulás */
  }
  return emptyData();
}

export async function save(data: AppData): Promise<void> {
  // Klónozás: IndexedDB structured clone, és ne tároljunk élő referenciát.
  const copy = JSON.parse(JSON.stringify(data)) as AppData;
  try {
    await idbSet(copy);
  } catch {
    localStorage.setItem(LS_KEY, JSON.stringify(copy));
  }
}

/** Kéri a böngészőt, hogy ne törölje magától az adatot. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* nem támogatott */
  }
}
