/** Mezőny-határok: szöveges bevitel, CSV import/export, összefésülés. */
import type { Cutoff, FieldBenchmark } from '../domain/types';
import { fold, parseCsvRows, parseDate } from './io';

/** „1=409, 3=332, 12=297” (vagy „1: 409; 3 332”) → határok, hely szerint rendezve. Hibás elemnél null. */
export function parseCutoffs(text: string): Cutoff[] | null {
  const parts = text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: Cutoff[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d{1,3})\s*[.=:\s]\s*(\d{1,4})$/);
    if (!m) return null;
    out.push({ rank: Number(m[1]), total: Number(m[2]) });
  }
  const ranks = new Set(out.map((c) => c.rank));
  if (ranks.size !== out.length) return null;
  return out.sort((a, b) => a.rank - b.rank);
}

export const formatCutoffs = (c: Cutoff[]) => c.map((x) => `${x.rank}=${x.total}`).join(', ');

const keyOf = (b: FieldBenchmark) => `${b.category}|${fold(b.series)}|${fold(b.event)}`;

/** Összefésülés: azonos azonosító vagy (kategória + sorozat + verseny) esetén a beérkező írja felül. */
export function mergeBenchmarks(existing: FieldBenchmark[], incoming: FieldBenchmark[]): { list: FieldBenchmark[]; added: number; updated: number } {
  const list = [...existing];
  let added = 0;
  let updated = 0;
  for (const b of incoming) {
    const i = list.findIndex((e) => e.id === b.id || keyOf(e) === keyOf(b));
    if (i >= 0) {
      list[i] = { ...b, id: list[i].id };
      updated++;
    } else {
      list.push(b);
      added++;
    }
  }
  return { list, added, updated };
}

const HEADER = ['Sorozat', 'Verseny', 'Dátum', 'Kategória', 'Indulók', 'Továbbjutó hely', 'Helyezés', 'Összpontszám', 'Saját összeg', 'Saját hely'];

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV export: határonként egy sor, pontosvesszővel, UTF-8 BOM-mal. */
export function exportBenchmarksCsv(list: FieldBenchmark[]): string {
  const lines = [HEADER.join(';')];
  for (const b of list)
    for (const c of b.cutoffs)
      lines.push([b.series, b.event, b.date, b.category === 'csapat' ? 'csapat' : 'egyéni', b.entrants, b.qualifyRank, c.rank, c.total, b.own?.total, b.own?.rank].map(cell).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Felismeri-e a fejléc a mezőny-határ CSV-t. */
export function isBenchmarkCsv(text: string): boolean {
  const head = (parseCsvRows(text)[0] ?? []).map(fold);
  return head.includes('osszpontszam') && head.includes('helyezes') && head.includes('verseny');
}

/** Mezőny-határ CSV beolvasása (határonként egy sor; a versenyenkénti adatok az első sorból). */
export function parseBenchmarksCsv(text: string, uid: () => string): { benchmarks: FieldBenchmark[]; warnings: string[] } {
  const rows = parseCsvRows(text);
  const head = rows[0].map(fold);
  const col = (name: string) => head.indexOf(fold(name));
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const num = (r: string[], name: string) => {
    const v = get(r, name);
    return v === '' || !/^\d+$/.test(v) ? undefined : Number(v);
  };
  const warnings: string[] = [];
  const map = new Map<string, FieldBenchmark>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const event = get(r, 'Verseny');
    const rank = num(r, 'Helyezés');
    const total = num(r, 'Összpontszám');
    if (!event || rank === undefined || total === undefined) {
      warnings.push(`${line}. sor: hiányzó verseny, helyezés vagy összpontszám, kihagyva.`);
      return;
    }
    const category: FieldBenchmark['category'] = fold(get(r, 'Kategória')).startsWith('csapat') ? 'csapat' : 'egyeni';
    const series = get(r, 'Sorozat') || 'Verseny';
    const key = `${category}|${fold(series)}|${fold(event)}`;
    let b = map.get(key);
    if (!b) {
      const date = get(r, 'Dátum');
      b = {
        id: uid(),
        series,
        event,
        date: date ? (parseDate(date) ?? undefined) : undefined,
        category,
        entrants: num(r, 'Indulók'),
        qualifyRank: num(r, 'Továbbjutó hely') ?? (category === 'csapat' ? 16 : 12),
        cutoffs: [],
      };
      const ownTotal = num(r, 'Saját összeg');
      if (ownTotal !== undefined) b.own = { total: ownTotal, rank: num(r, 'Saját hely') };
      map.set(key, b);
    }
    if (b.cutoffs.some((c) => c.rank === rank)) warnings.push(`${line}. sor: a(z) ${rank}. hely kétszer szerepel (${event}), az első marad.`);
    else b.cutoffs.push({ rank, total });
  });
  const benchmarks = [...map.values()].map((b) => ({ ...b, cutoffs: b.cutoffs.sort((x, y) => x.rank - y.rank) }));
  return { benchmarks, warnings };
}
