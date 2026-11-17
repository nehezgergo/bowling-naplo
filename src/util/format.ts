export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Átlag kijelzése egy tizedessel, magyar tizedesvesszővel. */
export const fmtAvg = (n: number | null | undefined): string =>
  n === null || n === undefined ? '–' : n.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Arány kiírása: kis mintánál (n < min) csak a darabszám, hogy ne tűnjön
 * magabiztosabbnak, mint amit az adat elbír; utána százalék is.
 */
export const fmtRate = (made: number, n: number, min = 10): string =>
  n === 0 ? '–' : n < min ? `${made}/${n}` : `${Math.round((made / n) * 100)}% (${made}/${n})`;

/**
 * Szám + „-szor/-szer/-ször” rag a magyar hangrend szerint (a szám kiejtett utolsó tagjához):
 * 1-szer, 2-szer, 3-szor, 4-szer, 5-ször, 6-szor, 7-szer, 8-szor, 9-szer, 10-szer, 20-szor, 100-szor, 1000-szer.
 */
export function times(n: number): string {
  const v = Math.abs(Math.trunc(n));
  const lastDigit = v % 10;
  let suffix: 'szor' | 'szer' | 'ször';
  if (v === 0) suffix = 'szor'; // nulla
  else if (lastDigit !== 0) suffix = ({ 1: 'szer', 2: 'szer', 3: 'szor', 4: 'szer', 5: 'ször', 6: 'szor', 7: 'szer', 8: 'szor', 9: 'szer' } as const)[lastDigit as 1];
  else if (v % 1_000_000 === 0) suffix = 'szor'; // millió
  else if (v % 1000 === 0) suffix = 'szer'; // ezer
  else if (v % 100 === 0) suffix = 'szor'; // száz
  else suffix = ({ 1: 'szer', 2: 'szor', 3: 'szor', 4: 'szer', 5: 'szer', 6: 'szor', 7: 'szer', 8: 'szor', 9: 'szer' } as const)[((v % 100) / 10) as 1]; // tíz, húsz, harminc…
  return `${n}-${suffix}`;
}

export const fmtInt = (n: number | null | undefined): string => (n === null || n === undefined ? '–' : String(n));

export const fmtSigned = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '–';
  const s = fmtAvg(Math.abs(n));
  return n > 0.05 ? `+${s}` : n < -0.05 ? `−${s}` : s;
};

export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
};

export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
