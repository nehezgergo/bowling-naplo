import { emptyData, defaultSettings, type AppData, type SessionTypeDef } from '../domain/types';

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

/** Hiányzó mezők pótlása régebbi/hiányos adatnál. */
export function normalize(raw: unknown): AppData {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppData>;
  return {
    schemaVersion: 1,
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
