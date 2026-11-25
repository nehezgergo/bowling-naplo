import { movingAverage, trend, type GameRef } from '../domain/stats';
import { typeKind, typeLabel } from '../domain/types';
import { fmtAvg, fmtSigned } from '../util/format';

export type ChartRange = '50' | '100' | 'all';
const RANGE_KEY = 'bowling-naplo-chart-range';

type Cat = 'edzes' | 'verseny' | 'egyeb';
const catOf = (g: GameRef): Cat => typeKind(g.type);
const CAT_LABEL: Record<Cat, string> = { edzes: 'Edzés', verseny: 'Verseny', egyeb: 'Egyéb' };

/** Pont-alak kategóriánként: a szín mellett az alak is megkülönböztet. */
function marker(cat: Cat, x: number, y: number, r = 4.5): string {
  if (cat === 'verseny')
    return `<path class="pt pt-${cat}" d="M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z"/>`;
  if (cat === 'egyeb') return `<rect class="pt pt-${cat}" x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5"/>`;
  return `<circle class="pt pt-${cat}" cx="${x}" cy="${y}" r="${r}"/>`;
}

const legendKey = (cat: Cat) =>
  `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${marker(cat, 7, 7, 4)}</svg>`;

function loadRange(): ChartRange {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    return v === '50' || v === '100' || v === 'all' ? v : '50';
  } catch {
    return '50';
  }
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
};

/** "Szép" rácsvonal-lépés a tartományhoz. */
function gridStep(span: number): number {
  return span > 160 ? 50 : span > 70 ? 25 : 10;
}

export interface ChartOptions {
  goal?: number;
}

/** Játékonkénti pontszám, 20-as mozgóátlag és trendvonal. */
export function mountScoreChart(host: HTMLElement, all: GameRef[], opts: ChartOptions = {}): void {
  let range = loadRange();
  const fullMa = movingAverage(all.map((g) => g.score), 20);

  host.innerHTML = `
    <div class="chart-head">
      <h2>Pontszámok</h2>
      <div class="seg" role="group" aria-label="Időszak">
        ${(['50', '100', 'all'] as ChartRange[])
          .map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${r === 'all' ? 'Összes' : r}</button>`)
          .join('')}
      </div>
    </div>
    <div class="chart-legend" id="chartLegend"></div>
    <div class="chart-wrap">
      <svg class="chart" id="chartSvg" role="img"></svg>
      <div class="chart-tip" id="chartTip" hidden></div>
    </div>
    <div class="chart-foot" id="chartFoot"></div>`;

  const svg = host.querySelector<SVGSVGElement>('#chartSvg')!;
  const tip = host.querySelector<HTMLElement>('#chartTip')!;
  const wrap = host.querySelector<HTMLElement>('.chart-wrap')!;

  let hover: ((clientX: number) => void) | null = null;

  const draw = () => {
    const start = range === 'all' ? 0 : Math.max(0, all.length - Number(range));
    const games = all.slice(start);
    const ma = fullMa.slice(start);
    const scores = games.map((g) => g.score);
    const tr = trend(scores);
    const cats = (['edzes', 'verseny', 'egyeb'] as Cat[]).filter((c) => games.some((g) => catOf(g) === c));

    host.querySelector('#chartLegend')!.innerHTML =
      cats.map((c) => `<span>${legendKey(c)}${CAT_LABEL[c]}</span>`).join('') +
      `<span><i class="key-line"></i>Utolsó 20 átlaga</span>` +
      (tr ? `<span><i class="key-line dashed"></i>Merre tart</span>` : '');

    const W = Math.max(300, wrap.clientWidth || 340);
    const H = 230;
    const m = { l: 34, r: 12, t: 10, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;

    const lo = Math.min(...scores, ...ma, opts.goal ?? Infinity);
    const hi = Math.max(...scores, ...ma, opts.goal ?? -Infinity);
    const step = gridStep(hi - lo);
    const y0 = Math.max(0, Math.floor((lo - 5) / step) * step);
    const y1 = Math.min(300, Math.ceil((hi + 5) / step) * step);
    const n = games.length;
    const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

    let grid = '';
    for (let v = y0; v <= y1; v += step) {
      grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }

    // Dátumcímkék: legfeljebb 4, egyenletesen.
    let xt = '';
    const labels = Math.min(4, n);
    const used = new Set<number>();
    for (let k = 0; k < labels; k++) {
      const i = labels === 1 ? 0 : Math.round((k / (labels - 1)) * (n - 1));
      if (used.has(i)) continue;
      used.add(i);
      const anchor = k === 0 && labels > 1 ? 'start' : k === labels - 1 && labels > 1 ? 'end' : 'middle';
      xt += `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="${anchor}">${shortDate(games[i].date)}</text>`;
    }

    const goalLine =
      opts.goal && opts.goal >= y0 && opts.goal <= y1
        ? `<line class="goal-line" x1="${m.l}" x2="${W - m.r}" y1="${y(opts.goal)}" y2="${y(opts.goal)}"/>
           <text class="goal-label" x="${m.l + 4}" y="${y(opts.goal) - 5}">Cél ${opts.goal}</text>`
        : '';

    const maPath = ma.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const trendLine = tr && n > 1
      ? `<line class="trend-line" x1="${x(0)}" y1="${y(tr.intercept)}" x2="${x(n - 1)}" y2="${y(tr.intercept + tr.slope * (n - 1))}"/>`
      : '';
    const points = games.map((g, i) => marker(catOf(g), x(i), y(g.score))).join('');

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', String(H));
    svg.setAttribute(
      'aria-label',
      `${n} játék pontszáma; mozgóátlag a végén ${fmtAvg(ma[n - 1])}` + (tr ? `; trend ${fmtSigned(tr.slope * 10)} pont / 10 játék` : ''),
    );
    svg.innerHTML = `${grid}${trendLine}<path class="ma-line" d="${maPath}"/>${points}${goalLine}
      <line class="cross" id="cross" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
      <rect class="hit" x="${m.l - 8}" y="0" width="${iw + 16}" height="${H}"/>`;

    host.querySelector('#chartFoot')!.innerHTML = tr && n >= 5
      ? `Merre tart: <b class="${tr.slope >= 0 ? 'up' : 'down'}">${fmtSigned(tr.slope * 10)}</b> pont 10 játékonként`
      : n < 5
        ? 'Néhány játék után itt látod, javulsz-e.'
        : '';

    const cross = svg.querySelector<SVGLineElement>('#cross')!;
    hover = (clientX: number) => {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * W;
      const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      const g = games[i];
      cross.setAttribute('x1', String(x(i)));
      cross.setAttribute('x2', String(x(i)));
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = String(g.score);
      const l1 = document.createElement('div');
      l1.textContent = `${shortDate(g.date)} · ${typeLabel(g.type)} · ${g.index}. játék`;
      const l2 = document.createElement('div');
      l2.textContent = `${g.ball} · utolsó 20 átlaga ${fmtAvg(ma[i])}`;
      tip.append(strong, l1, l2);
      tip.hidden = false;
      const left = (x(i) / W) * rect.width;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(rect.width - tw, left - tw / 2))}px`;
    };
  };

  const hide = () => {
    tip.hidden = true;
    svg.querySelector('#cross')?.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('pointermove', (e) => hover?.(e.clientX));
  svg.addEventListener('pointerdown', (e) => hover?.(e.clientX));
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });

  host.querySelector('.seg')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-range]');
    if (!b) return;
    range = b.dataset.range as ChartRange;
    try {
      localStorage.setItem(RANGE_KEY, range);
    } catch {
      /* nem kritikus */
    }
    host.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    hide();
    draw();
  });

  draw();
  let lastW = wrap.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(wrap.clientWidth - lastW) > 4) {
      lastW = wrap.clientWidth;
      hide();
      draw();
    }
  }).observe(wrap);
}
