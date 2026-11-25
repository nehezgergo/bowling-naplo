import { bestWarmup, coldStart, MIN_SAMPLE, warmupBuckets, warmupCount, type ColdStart } from '../domain/coldstart';
import { getData } from '../state';
import { fieldTables, mountChance, mountLive } from './fieldView';
import { esc, fmtAvg, fmtSigned } from '../util/format';

/** Egy sor a hidegindítás-táblához; kis mintánál „kevés adat” jelzéssel. */
export function coldRow(label: string, c: ColdStart): string {
  if (c.n === 0) return `<tr><td>${esc(label)}</td><td colspan="4" class="muted">nincs kétjátékos alkalom</td></tr>`;
  const diff = c.firstAvg !== null && c.secondAvg !== null ? c.secondAvg - c.firstAvg : null;
  return `<tr>
    <td>${esc(label)} <span class="muted small">${c.n} alkalom</span>${c.enough ? '' : '<div class="few">kevés adat</div>'}</td>
    <td class="num">${fmtAvg(c.firstAvg)}</td>
    <td class="num">${fmtAvg(c.secondAvg)}</td>
    <td class="num ${diff !== null && diff > 0 ? 'down-txt' : ''}">${fmtSigned(diff)}</td>
    <td class="num">${c.secondBetter}/${c.n}</td>
  </tr>`;
}

export const coldTable = (rows: string) => `<table class="tbl cold-tbl">
  <thead><tr><th></th><th>1. játék</th><th>2. játék</th><th>Különbség</th><th>2. jobb</th></tr></thead>
  <tbody>${rows}</tbody></table>`;

export function renderPrepPage(root: HTMLElement): void {
  const { sessions } = getData();
  const comp = coldStart(sessions, 'verseny');
  const all = coldStart(sessions, 'mind');
  // A bemelegítést elsősorban versenyekből nézzük; ha ott kevés, az összes alkalomból.
  const compBest = bestWarmup(sessions, 'verseny');
  const best = compBest ?? bestWarmup(sessions, 'mind');
  const bestScope = compBest ? 'versenyeken' : 'összes alkalmon';
  const buckets = warmupBuckets(sessions, 'mind');
  const nWarm = warmupCount(sessions, 'mind');

  let verdict = '';
  if (comp.enough && comp.firstAvg !== null && comp.secondAvg !== null) {
    const d = comp.secondAvg - comp.firstAvg;
    verdict =
      d >= 5
        ? `Versenyen az 1. játékod átlagosan <b>${fmtAvg(d)} ponttal</b> gyengébb a másodiknál (${comp.n} verseny alapján). Ezért fontos az alapos bemelegítés.`
        : d <= -5
          ? `Versenyen az 1. játékod az erősebb (${comp.n} verseny alapján). A 2. játékra figyelj: ne kapkodj, pihenj, igyál.`
          : `Versenyen nincs nagy különbség az 1. és a 2. játék között (${comp.n} verseny alapján).`;
  } else {
    verdict = `Versenyen ${comp.n} kétjátékos alkalom van; legalább ${MIN_SAMPLE} kell, hogy következtetést vonjunk le.`;
  }

  root.innerHTML = `
    <h1 class="page-title">Verseny előtt</h1>

    <section class="card" id="chanceCard"></section>
    <section class="card" id="liveCard"></section>

    <section class="card">
      <h2>Jól indulsz?</h2>
      <p>${verdict}</p>
      ${coldTable(coldRow('Verseny', comp) + coldRow('Összes', all))}
    </section>

    <section class="card prep-best">
      <h2>Ami eddig bevált</h2>
      ${
        best
          ? `<div class="focus">
               <div class="focus-label">Bemelegítés (${bestScope})</div>
               <div class="focus-title">${esc(best.bucket.label)}${best.avgMinutes !== null ? `, kb. ${Math.round(best.avgMinutes)} perc` : ''}</div>
               <div class="focus-text">Ezzel az 1. játék átlaga ${fmtAvg(best.bucket.firstAvg)} (${best.bucket.n} alkalom alapján).</div>
               ${best.routine ? `<div class="prep-routine">„${esc(best.routine)}”<div class="muted small">${esc(best.routineDate ?? '')}, 1. játék: ${best.routineFirst}</div></div>` : ''}
             </div>`
          : `<p class="muted">Még kevés adat: ${nWarm} alkalomnál írtad be a bemelegítést. Írd be minden alkalom végén (Összegzés), és legalább ${MIN_SAMPLE} hasonló után itt látod, melyik válik be.</p>`
      }
      <h3 class="sub-h">1. játék a bemelegítő dobások szerint</h3>
      <table class="tbl">
        <thead><tr><th></th><th>Alkalom</th><th>1. játék átlaga</th></tr></thead>
        <tbody>${buckets
          .map(
            (b) => `<tr><td>${esc(b.label)}</td><td>${b.n}</td><td class="num">${
              b.firstAvg !== null ? fmtAvg(b.firstAvg) : b.n ? `<span class="few">kevés adat</span> <span class="muted small">(${fmtAvg(b.rawAvg)})</span>` : '–'
            }</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </section>

    ${fieldTables()}
    <p class="muted small center"><a href="#/beallitasok">A versenyek pontjainak szerkesztése a Beállításokban</a></p>`;

  mountChance(root.querySelector('#chanceCard')!);
  mountLive(root.querySelector('#liveCard')!);
}
