/** Szakszavak közérthetően: a szövegekben koppintható szavak, és a teljes szótár oldal. */
import { esc } from '../util/format';

export interface Term {
  id: string;
  name: string;
  text: string;
  /** Szótő, amire a szövegben illeszkedik (a magyar ragokkal együtt). */
  match: string;
}

export const TERMS: Term[] = [
  { id: 'strike', name: 'Strike (X)', match: 'strike', text: 'Az első dobással mind a 10 bábut ledöntöd. A pontja: 10, plusz a következő két dobásod.' },
  { id: 'spare', name: 'Spare (/)', match: 'spare', text: 'A második dobással ledöntöd az összes megmaradt bábut. A pontja: 10, plusz a következő dobásod.' },
  { id: 'split', name: 'Split', match: 'split', text: 'Az első dobás után úgy maradnak bábuk, hogy rés van köztük, és az elülső (1-es) bábu már nem áll. Nehéz mindet eltalálni, ezért általában érdemes egyet biztosan leütni.' },
  { id: 'kor', name: 'Kör (frame)', match: '', text: 'Egy játék 10 körből áll. Egy körben legfeljebb két dobásod van, a 10. körben lehet három is.' },
  { id: 'zseb', name: 'Zseb', match: 'zseb', text: 'Az a hely, ahová a strike-hoz célozni érdemes: jobbkezesnél az 1-es és a 3-as, balkezesnél az 1-es és a 2-es bábu közé.' },
  { id: 'deszka', name: 'Deszkacsík (board)', match: 'deszkacsík', text: 'A pálya keskeny, hosszanti fa csíkokból áll. Egy csík kb. 2,7 cm széles. Ha „2 deszkacsíkot” lépsz, az kb. 5 cm.' },
  { id: 'nyil', name: 'Nyíl', match: 'nyíl|nyilak|nyilat|nyilra', text: 'A pályán, néhány méterre a vonal után látható 7 nyíl. Könnyebb rájuk célozni, mint a messze álló bábukra.' },
  { id: 'nyitott', name: 'Nyitott kör', match: 'nyitott kör', text: 'Olyan kör, ahol a két dobás után is maradt álló bábu: se strike, se spare.' },
  { id: 'olaj', name: 'Olajozás', match: 'olajozás|olajon', text: 'A pálya elejét olajjal vonják be. Az olajos részen a golyó csúszik, utána megkapaszkodik és fordulhat. Rövid olajnál hamarabb fordul, hosszúnál később.' },
  { id: 'spare-golyo', name: 'Spare golyó', match: '', text: 'Sima (műanyag) golyó, ami egyenesen gurul. A megmaradt bábukra ezért kiszámíthatóbb.' },
  { id: 'vonal', name: 'Célpont, vonal', match: '', text: 'Az az út, amin a golyót el akarod gurítani: hol állsz, és melyik nyíl fölött megy át.' },
  { id: 'babuk', name: 'A bábuk számozása', match: '', text: 'Elöl az 1-es, mögötte a 2–3, aztán a 4–5–6, hátul a 7–8–9–10, mindig balról jobbra. A 7-es a bal hátsó, a 10-es a jobb hátsó sarok.' },
  { id: 'hatar', name: 'Határ (továbbjutási)', match: '', text: 'Ennyi pont kellett a továbbjutáshoz. Az app a korábbi versenyek alapján becsüli.' },
  { id: 'esely', name: 'Esély', match: '', text: 'Becslés a korábbi játékaidból: az app sok ezerszer „lejátssza” a versenyt a te pontjaiddal, és megnézi, hányszor sikerült.' },
  { id: 'szokasos', name: 'Szokásos / szokatlan nap', match: '', text: 'Minden játékosnak ingadozik az eredménye. „Szokásos” = belefér a megszokott ingadozásba. „Szokatlan” = ennél jobb vagy gyengébb.' },
];

const PATTERN = new RegExp(
  `(?<![\\p{L}\\d])(${TERMS.filter((t) => t.match).sort((a, b) => b.match.length - a.match.length).map((t) => `(?<${t.id.replace('-', '_')}>${t.match})`).join('|')})[\\p{L}-]*`,
  'giu',
);

/**
 * Szöveg HTML-lé alakítása (escape-elve), benne a szakszavak koppinthatók.
 * Egy szó szövegenként csak egyszer lesz koppintható, hogy ne legyen zsúfolt.
 */
export function explain(text: string): string {
  const seen = new Set<string>();
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const id = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out += esc(text.slice(last, m.index)) + `<button type="button" class="term" data-term="${id}">${esc(m[0])}</button>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

export function showTerm(id: string): void {
  const t = TERMS.find((x) => x.id === id);
  if (!t) return;
  document.querySelector('.term-sheet')?.remove();
  const el = document.createElement('div');
  el.className = 'saved-sheet term-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t.name);
  el.innerHTML = `<div class="saved-card"><div class="saved-title">${esc(t.name)}</div><p>${esc(t.text)}</p><button type="button" class="btn btn-primary">Értem</button></div>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  el.querySelector('button')!.focus();
}

/** Egyszer kell meghívni: minden koppintható szakszóra működik. */
export function initGlossary(): void {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-term]');
    if (!b) return;
    e.preventDefault();
    showTerm(b.dataset.term!);
  });
}

export function renderGlossary(root: HTMLElement): void {
  root.innerHTML = `<h1 class="page-title">Szótár</h1>
    <p class="muted">A bowling és az app szavai, egyszerűen.</p>
    ${TERMS.map((t) => `<section class="card"><h2>${esc(t.name)}</h2><p>${esc(t.text)}</p></section>`).join('')}`;
}
