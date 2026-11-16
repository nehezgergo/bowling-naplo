import type { AppData } from '../domain/types';

const DAY = 86_400_000;
export const REMIND_AFTER_DAYS = 30;
export const SNOOZE_DAYS = 7;

export interface BackupReminder {
  /** Hány napja volt az utolsó mentés (null: még soha). */
  days: number | null;
  /** Hány alkalom új vagy módosult azóta. */
  changed: number;
}

/**
 * Kell-e mentési emlékeztető: van mentetlen változás, és
 * - volt már mentés, de legalább 30 napja, vagy
 * - még soha nem mentett, és legalább 5 alkalom van, vagy az első egy hétnél régebbi.
 * Az „Később” gomb egy hétre elhalasztja.
 */
export function backupReminder(data: AppData, now = new Date()): BackupReminder | null {
  const { sessions, settings } = data;
  if (sessions.length === 0) return null;
  if (settings.backupSnoozeUntil && Date.parse(settings.backupSnoozeUntil) > now.getTime()) return null;
  const last = settings.lastExportAt;
  const changed = sessions.filter((s) => !last || s.updatedAt > last || s.createdAt > last).length;
  if (changed === 0) return null;
  if (last) {
    const days = Math.floor((now.getTime() - Date.parse(last)) / DAY);
    return days >= REMIND_AFTER_DAYS ? { days, changed } : null;
  }
  const oldest = Math.min(...sessions.map((s) => Date.parse(s.createdAt)));
  return sessions.length >= 5 || now.getTime() - oldest >= 7 * DAY ? { days: null, changed } : null;
}

export const snoozeUntil = (now = new Date()) => new Date(now.getTime() + SNOOZE_DAYS * DAY).toISOString();
