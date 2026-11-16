import { average, NO_BALL, sessionAverage } from '../domain/stats';
import { SESSION_TYPES, typeLabel, type Session } from '../domain/types';
import { getData } from '../state';
import { esc, fmtAvg, fmtDate, todayIso } from '../util/format';

export type Period = 'all' | '30' | '90' | '365' | 'year';

export interface LogFilter {
  type: string; // '' = mind
  ball: string;
  period: Period;
}

const FILTER_KEY = 'bowling-naplo-filter';
const defaultFilter: LogFilter = { type: '', ball: '', period: 'all' };

function loadFilter(): LogFilter {
  try {
    return { ...defaultFilter, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') };
  } catch {
    return { ...defaultFilter };
  }
}
function storeFilter(f: LogFilter) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    /* nem kritikus */
  }
}

/** Az időszak kezdő dátuma (YYYY-MM-DD), vagy null ha nincs korlát. */
export function periodStart(p: Period, today = todayIso()): string | null {
  if (p === 'all') return null;
  if (p === 'year') return `${today.slice(0, 4)}-01-01`;
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - Number(p) + 1);
  return dt.toISOString().slice(0, 10);
}

export function filterSessions(sessions: Session[], f: LogFilter, today = todayIso()): Session[] {
  const start = periodStart(f.period, today);
  return sessions.filter((s) => {
    if (f.type && s.type !== f.type) return false;
    if (start && s.date < start) return false;
    if (f.ball) {
      const balls = new Set(s.games.map((g) => g.ball || s.ball || NO_BALL));
      if (!balls.has(f.ball)) return false;
    }
    return true;
  });
}

const opt = (value: string, label: string, cur: string) =>
  `<option value="${esc(value)}"${value === cur ? ' selected' : ''}>${esc(label)}</option>`;

export function renderLog(root: HTMLElement): void {
  const { sessions, settings } = getData();
  const f = loadFilter();
  const ballOptions = [...new Set([...settings.balls, ...sessions.map((s) => s.ball).filter((b): b is string => !!b)])];

  const draw = () => {
    const list = filterSessions(sessions, f).sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
    const allScores = list.flatMap((s) => s.games.map((g) => g.score));
    root.querySelector('#logSummary')!.innerHTML = list.length
      ? `${list.length} alkalom · ${allScores.length} játék · átlag <b>${fmtAvg(average(allScores))}</b>`
      : '';
    root.querySelector('#logList')!.innerHTML = list.length
      ? list
          .map((s) => {
            const scores = [...s.games].sort((a, b) => a.index - b.index).map((g) => g.score);
            const best = Math.max(...scores);
            return `<a class="card log-item" href="#/uj?id=${encodeURIComponent(s.id)}">
              <div class="log-top">
                <span class="log-date">${esc(fmtDate(s.date))}</span>
                <span class="log-avg">${fmtAvg(sessionAverage(s))}</span>
              </div>
              <div class="log-meta">
                <span class="badge t-${s.type}">${esc(typeLabel(s.type))}</span>
                ${s.ball ? `<span class="badge">${esc(s.ball)}</span>` : ''}
                ${s.eventName ? `<span class="muted">${esc(s.eventName)}</span>` : ''}
              </div>
              <div class="log-scores">${scores
                .map((n) => `<span class="score${n === best && scores.length > 1 ? ' best' : ''}${n >= 200 ? ' s200' : ''}">${n}</span>`)
                .join('')}</div>
            </a>`;
          })
          .join('')
      : `<div class="empty small"><p>${sessions.length ? 'Nincs a szűrésnek megfelelő alkalom.' : 'Még nincs rögzített alkalom.'}</p>
         ${sessions.length ? '' : '<a class="btn btn-primary" href="#/uj">Új alkalom</a>'}</div>`;
  };

  root.innerHTML = `
    <h1 class="page-title">Napló</h1>
    <div class="filters">
      <select id="fType" aria-label="Típus">${opt('', 'Minden típus', f.type)}${SESSION_TYPES.map((t) => opt(t.id, t.label, f.type)).join('')}</select>
      <select id="fBall" aria-label="Golyó">${opt('', 'Minden golyó', f.ball)}${ballOptions.map((b) => opt(b, b, f.ball)).join('')}</select>
      <select id="fPeriod" aria-label="Időszak">
        ${opt('all', 'Teljes idő', f.period)}${opt('30', 'Utolsó 30 nap', f.period)}${opt('90', 'Utolsó 90 nap', f.period)}
        ${opt('365', 'Utolsó 12 hónap', f.period)}${opt('year', 'Idei év', f.period)}
      </select>
    </div>
    <div class="log-summary" id="logSummary"></div>
    <div id="logList" class="log-list"></div>`;

  const bind = (id: string, key: keyof LogFilter) =>
    root.querySelector<HTMLSelectElement>(`#${id}`)!.addEventListener('change', (e) => {
      (f as unknown as Record<string, string>)[key] = (e.target as HTMLSelectElement).value;
      storeFilter(f);
      draw();
    });
  bind('fType', 'type');
  bind('fBall', 'ball');
  bind('fPeriod', 'period');
  draw();
}
