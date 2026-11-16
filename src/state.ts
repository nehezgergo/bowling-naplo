import { emptyData, type AppData, type CoachReport, type Session, type Settings } from './domain/types';
import { load, save } from './storage/db';

let data: AppData = emptyData();

export const getData = () => data;

export async function init(): Promise<void> {
  data = await load();
}

async function commit(): Promise<void> {
  await save(data);
}

export async function upsertSession(s: Session): Promise<void> {
  const i = data.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) data.sessions[i] = s;
  else data.sessions.push(s);
  await commit();
}

export async function deleteSession(id: string): Promise<void> {
  data.sessions = data.sessions.filter((s) => s.id !== id);
  await commit();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  data.settings = { ...data.settings, ...patch };
  await commit();
}

export async function addCoachReport(r: CoachReport): Promise<void> {
  data.coachReports = [...data.coachReports, r];
  await commit();
}

export async function deleteCoachReport(id: string): Promise<void> {
  data.coachReports = data.coachReports.filter((r) => r.id !== id);
  await commit();
}

export async function replaceAll(next: AppData): Promise<void> {
  data = next;
  await commit();
}

/** A legutóbb rögzített alkalom (a gyors bevitel alapértékeihez). */
export function lastSession(): Session | undefined {
  return [...data.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
