/** Mezőnymodell a „Verseny előtt” oldalon: esély, élő célszám, határok táblázata, zajjelző. */
import {
  averageCutoffs,
  buildPools,
  chanceText,
  defaultCutoff,
  liveTarget,
  noiseFor,
  simulateTwoGames,
  type Noise,
} from '../domain/simulation';
import { defaultSim, type FieldBenchmark, type SimSettings } from '../domain/types';
import { getData, updateSettings } from '../state';
import { esc, fmtAvg, times } from '../util/format';

const sim = (): SimSettings => ({ ...defaultSim(), ...(getData().settings.sim ?? {}) });
const benchmarks = (): FieldBenchmark[] => getData().benchmarks ?? [];

export function noiseBadge(n: Noise): string {
  const title = n.verdict === 'keves' ? `kevesebb mint 10 korábbi játék (n=${n.n})` : `várható ${Math.round(n.expected)}, eltérés ${n.z >= 0 ? '+' : ''}${n.z.toFixed(1)} szórás (n=${n.n})`;
  const label = { 'savon-belul': 'szokásos sáv', 'kiugro-jo': '▲ kiugró', 'kiugro-gyenge': '▼ kiugró', keves: 'kevés előzmény' }[n.verdict];
  return `<span class="noise noise-${n.verdict}" title="${esc(title)}">${label}</span>`;
}

/** Esély-kártya: beállítások + szimuláció eredménye. */
export function mountChance(el: HTMLElement): void {
  const draw = () => {
    const s = sim();
    const auto = defaultCutoff(benchmarks(), 'egyeni');
    const cutoff = s.cutoff ?? auto;
    const pools = buildPools(getData().sessions, s);
    const r = simulateTwoGames(pools, { splitFirst: s.splitFirst });
    const ranks = averageCutoffs(benchmarks(), 'egyeni');

    let body = '<p class="muted">Még nincs játék, amiből számolni lehetne.</p>';
    if (r) {
      const c = cutoff !== null ? chanceText(r.chance(cutoff), r.n) : null;
      const lo = Math.min(r.p10, cutoff ?? r.p10) - 20;
      const hi = Math.max(r.p90, cutoff ?? r.p90) + 20;
      const pos = (v: number) => (((v - lo) / (hi - lo)) * 100).toFixed(1);
      body = `
        <div class="chance-main">
          <div><div class="chance-big">${c ? esc(c.text.replace(' (bizonytalan)', '')) : '–'}</div><div class="muted small">esély a határra${cutoff !== null ? ` (≥ ${cutoff})` : ''}</div>${c && !c.sure ? `<div class="few">bizonytalan: csak ${r.n} játék</div>` : ''}</div>
          <div><div class="chance-big">${Math.round(r.mean)}</div><div class="muted small">várható összeg</div></div>
        </div>
        <div class="band" aria-label="10–90%-os sáv: ${r.p10}–${r.p90}">
          <div class="band-range" style="left:${pos(r.p10)}%;width:${(Number(pos(r.p90)) - Number(pos(r.p10))).toFixed(1)}%"></div>
          <div class="band-mid" style="left:${pos(r.p50)}%"></div>
          ${cutoff !== null ? `<div class="band-cut" style="left:${pos(cutoff)}%"><span>${cutoff}</span></div>` : ''}
        </div>
        <div class="band-legend"><span>10%: ${r.p10}</span><span>medián: ${r.p50}</span><span>90%: ${r.p90}</span></div>
        <p class="muted small">${r.n} játékból (1. játék: ${r.nFirst}, további: ${r.nLater}) · ${
          r.mode === 'kulon' ? 'az 1. és a 2. játék külön mintázva' : 'közös mintából (kevés az 1. vagy a további játék a külön mintázáshoz)'
        } · ${r.runs.toLocaleString('hu-HU')} szimulált verseny</p>
        ${
          ranks.length
            ? `<table class="tbl"><thead><tr><th>Hely (utolsó 3 verseny átlaga)</th><th>Határ</th><th>Esély</th></tr></thead><tbody>${ranks
                .map((x) => `<tr><td>${x.rank}. hely</td><td>${x.total}</td><td class="num">${esc(chanceText(r.chance(x.total), r.n).text)}</td></tr>`)
                .join('')}</tbody></table>`
            : ''
        }`;
    }

    el.innerHTML = `
      <h2>Esély a továbbjutásra <span class="hint">egyéni, 2 játék összege</span></h2>
      <div class="sim-controls">
        <label>Utolsó <input id="simN" inputmode="numeric" maxlength="3" value="${s.games}"> játék</label>
        <select id="simFilter" aria-label="Melyik játékokból">
          <option value="mind"${s.filter === 'mind' ? ' selected' : ''}>minden</option>
          <option value="verseny"${s.filter === 'verseny' ? ' selected' : ''}>csak verseny</option>
          <option value="edzes"${s.filter === 'edzes' ? ' selected' : ''}>csak edzés</option>
        </select>
        <label>Határ <input id="simCut" inputmode="numeric" maxlength="3" placeholder="${auto ?? ''}" value="${s.cutoff ?? ''}"></label>
        <label class="check"><input type="checkbox" id="simSplit"${s.splitFirst ? ' checked' : ''}> 1. és 2. játék külön</label>
      </div>
      <p class="muted small">${auto !== null ? `Alap határ: ${auto} (az utolsó 3 verseny 12. helyének átlaga)${s.cutoff !== undefined ? ', most kézzel felülírva' : ''}.` : 'Adj meg határt, vagy töltsd fel a mezőny-határokat a Beállításokban.'}</p>
      ${body}`;

    const save = async (patch: Partial<SimSettings>) => {
      await updateSettings({ sim: { ...sim(), ...patch } });
      draw();
    };
    el.querySelector<HTMLInputElement>('#simN')!.addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      save({ games: Number.isInteger(v) && v >= 5 && v <= 500 ? v : 40 });
    });
    el.querySelector<HTMLSelectElement>('#simFilter')!.addEventListener('change', (e) => save({ filter: (e.target as HTMLSelectElement).value as SimSettings['filter'] }));
    el.querySelector<HTMLInputElement>('#simCut')!.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const v = Number(raw);
      save({ cutoff: raw === '' || !Number.isInteger(v) || v < 1 || v > 600 ? undefined : v });
    });
    el.querySelector<HTMLInputElement>('#simSplit')!.addEventListener('change', (e) => save({ splitFirst: (e.target as HTMLInputElement).checked }));
  };
  draw();
}

/** Élő célszám: beírod az 1. játékot, kiírja, mennyi kell a 2.-ban. */
export function mountLive(el: HTMLElement): void {
  el.innerHTML = `
    <h2>Élő célszám <span class="hint">a verseny közben</span></h2>
    <div class="live-row">
      <label for="liveFirst">1. játék</label>
      <input id="liveFirst" class="game-input" inputmode="numeric" maxlength="3" placeholder="0–300" autocomplete="off">
    </div>
    <div id="liveOut" class="live-out" role="status" aria-live="polite"></div>`;
  const out = el.querySelector<HTMLElement>('#liveOut')!;
  el.querySelector<HTMLInputElement>('#liveFirst')!.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
    const first = Number(inp.value);
    const s = sim();
    const cutoff = s.cutoff ?? defaultCutoff(benchmarks(), 'egyeni');
    if (inp.value === '' || first > 300) return void (out.innerHTML = '');
    if (cutoff === null) return void (out.innerHTML = '<p class="muted">Adj meg határt fent.</p>');
    const pools = buildPools(getData().sessions, s);
    const second = pools.later.length >= 5 ? pools.later : pools.all;
    const t = liveTarget(first, cutoff, second);
    if (t.status === 'megvan') out.innerHTML = `<div class="live-need ok">Megvan!</div><p>Az 1. játékkal már elérted a ${cutoff}-es határt.</p>`;
    else if (t.status === 'lehetetlen') out.innerHTML = `<div class="live-need">${t.need}</div><p>Ennyi egy játékban nem dobható. A ${cutoff}-es határ most nem elérhető, a lehető legjobb helyezésért játssz.</p>`;
    else {
      const c = chanceText(t.n ? t.hits / t.n : 0, t.n);
      out.innerHTML = `<div class="live-need">${t.need}</div>
        <p>kell a 2. játékban a ${cutoff}-es határhoz.</p>
        <p class="muted">Eddig ${t.n} ${second === pools.later ? '2. vagy későbbi' : ''} játékodból ${times(t.hits)} dobtál legalább ennyit: <b>${esc(c.text)}</b>.</p>`;
    }
  });
}

/** Mezőny-határok táblázata (egyéni: zajjelzővel; csapat: csak tájékoztató). */
export function fieldTables(): string {
  const list = [...benchmarks()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (list.length === 0) return `<section class="card"><h2>Mezőny-határok</h2><p class="muted">Nincs még mezőny-adat. A Beállításokban adhatod meg vagy importálhatod.</p></section>`;
  const { sessions } = getData();
  const cutAt = (b: FieldBenchmark, r: number) => b.cutoffs.find((c) => c.rank === r)?.total ?? '–';
  const ind = list.filter((b) => b.category === 'egyeni');
  const team = list.filter((b) => b.category === 'csapat');
  return `
    ${
      ind.length
        ? `<section class="card"><h2>Mezőny – egyéni <span class="hint">2 játék összege</span></h2>
            <table class="tbl field-tbl"><thead><tr><th>Verseny</th><th>Indulók</th><th>Továbbjutó</th><th>Saját</th></tr></thead><tbody>
            ${ind
              .map((b) => {
                const own = b.own;
                const noise = own && b.date ? noiseFor(sessions, b.date, own.total, 2) : null;
                return `<tr><td>${esc(b.series)} ${esc(b.event)}</td><td>${b.entrants ?? '–'}</td><td>${b.qualifyRank}.: ${cutAt(b, b.qualifyRank)}</td>
                  <td class="num">${own ? `${own.total}${own.rank ? ` (${own.rank}.)` : ''}` : '–'}${noise ? `<div>${noiseBadge(noise)}</div>` : ''}</td></tr>`;
              })
              .join('')}</tbody></table>
            <p class="muted small">Zajjelző: a verseny előtti játékaidhoz mérve (átlag × 2 ± 1 szórás). „Szokásos sáv”: ne nézd trendnek; „kiugró”: valóban szokatlanul jó vagy gyenge nap.</p></section>`
        : ''
    }
    ${
      team.length
        ? `<section class="card"><h2>Mezőny – csapat <span class="hint">5 fő, 2 forduló</span></h2>
            <table class="tbl field-tbl"><thead><tr><th>Verseny</th><th>Csapatok</th><th>Továbbjutó</th><th>Saját csapat</th></tr></thead><tbody>
            ${team.map((b) => `<tr><td>${esc(b.series)} ${esc(b.event)}</td><td>${b.entrants ?? '–'}</td><td>${b.qualifyRank}.: ${cutAt(b, b.qualifyRank)}</td><td class="num">${b.own ? `${b.own.total}${b.own.rank ? ` (${b.own.rank}.)` : ''}` : '–'}</td></tr>`).join('')}
            </tbody></table>
            <p class="muted small">Csapatesélyt nem számolok: a csapattársak játékai nincsenek az appban.</p></section>`
        : ''
    }`;
}

export const fmtCut = (n: number | null) => (n === null ? '–' : fmtAvg(n));
