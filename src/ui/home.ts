import { coachTips, nextFocus, sessionFeedback, type CoachTip } from '../coach/rules';
import { pct, sessionFrameStats, worstLeaves, type FrameStats } from '../domain/scoring';
import { dashboard, goalProgress, type GroupAvg } from '../domain/stats';
import { typeLabel, type CoachReport, type SessionType } from '../domain/types';
import { getData, updateSettings } from '../state';
import { backupReminder, snoozeUntil } from '../storage/backup';
import { exportJson } from '../storage/io';
import { esc, fmtAvg, fmtInt, fmtSigned, todayIso } from '../util/format';
import { mountScoreChart } from './chart';
import { saveFile } from './files';
import { takeJustSaved, toast } from './shell';

const tile = (label: string, value: string, extra = '') =>
  `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${esc(label)}</div>${extra}</div>`;

const groupTable = (title: string, rows: GroupAvg[], label: (k: string) => string) =>
  rows.length
    ? `<section class="card"><h2>${esc(title)}</h2><table class="tbl">
        <thead><tr><th></th><th>Játék</th><th>Átlag</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(label(r.key))}</td><td>${r.count}</td><td class="num">${fmtAvg(r.average)}</td></tr>`).join('')}
      </tbody></table></section>`
    : '';

const LEVEL_ICON: Record<CoachTip['level'], string> = { jo: '▲', figyelem: '!', info: 'i' };
const LEVEL_LABEL: Record<CoachTip['level'], string> = { jo: 'Erősség', figyelem: 'Fejlesztendő', info: 'Megfigyelés' };

const tipHtml = (t: CoachTip) => `
  <li class="tip tip-${t.level}">
    <span class="tip-icon" aria-label="${LEVEL_LABEL[t.level]}">${LEVEL_ICON[t.level]}</span>
    <div><div class="tip-title">${esc(t.title)}</div><div class="tip-text">${esc(t.text)}</div></div>
  </li>`;

function claudeBlock(latest: CoachReport | undefined): string {
  return `<a class="claude-link" href="#/edzo">
    <span><b>Claude-edző</b>${
      latest
        ? `<span class="muted"> · cél: ${esc(latest.advice.nextGoal.metric)}: ${esc(latest.advice.nextGoal.target)}</span>`
        : '<span class="muted"> · személyre szabott elemzés és edzésterv</span>'
    }</span><span aria-hidden="true">›</span></a>`;
}

function coachCard(tips: CoachTip[], gamesCount: number, latest?: CoachReport): string {
  if (gamesCount < 3)
    return `<section class="card coach"><h2>Edző</h2><p class="muted">Rögzíts még néhány játékot, és itt személyre szabott tanácsokat kapsz.</p>${claudeBlock(latest)}</section>`;
  const focus = nextFocus(tips);
  const rest = tips.filter((t) => t !== focus);
  const shown = rest.slice(0, 4);
  return `<section class="card coach">
    <h2>Edző</h2>
    ${
      focus
        ? `<div class="focus"><div class="focus-label">Következő edzés fókusza</div>
             <div class="focus-title">${esc(focus.title)}</div><div class="focus-text">${esc(focus.drill!)}</div></div>`
        : ''
    }
    ${shown.length ? `<ul class="tips">${shown.map(tipHtml).join('')}</ul>` : '<p class="muted">Most nincs kiemelendő eltérés. Gyűjts még adatot, főleg az „Az edzőnek” mezőkben.</p>'}
    ${rest.length > shown.length ? `<details class="tips-more"><summary>További ${rest.length - shown.length} megfigyelés</summary><ul class="tips">${rest.slice(4).map(tipHtml).join('')}</ul></details>` : ''}
    ${claudeBlock(latest)}
  </section>`;
}

function frameCard(fs: FrameStats, corner: number): string {
  if (fs.games === 0)
    return `<section class="card"><h2>Frame-statisztika</h2><p class="muted">Egy játék sorában a ▦ gombbal frame-enként, bábu-ábrával is rögzíthetsz. Ebből számolom a strike-, spare- és split-arányt.</p></section>`;
  const p = (a: number, b: number) => {
    const v = pct(a, b);
    return v === null ? '–' : `${Math.round(v)}%`;
  };
  const worst = worstLeaves(fs);
  const sub = (t: string) => `<div class="tile-sub">${esc(t)}</div>`;
  return `<section class="card">
    <h2>Frame-statisztika <span class="hint">${fs.games} részletes játék</span></h2>
    <div class="tiles tiles-in">
      ${tile('Strike', p(fs.strikes, fs.strikeChances), sub(`${fs.strikes}/${fs.strikeChances}`))}
      ${tile('Spare', p(fs.spares, fs.spareChances), sub(`${fs.spares}/${fs.spareChances}`))}
      ${tile('Nyitott / játék', fmtAvg(fs.opens / fs.games))}
      ${tile('Egy bábus spare', p(fs.singlePinSpares, fs.singlePinChances), sub(`${fs.singlePinSpares}/${fs.singlePinChances}`))}
      ${tile(`${corner}-es bábu`, fs.cornerLeaves ? p(fs.cornerSpares, fs.cornerLeaves) : '–', sub(`${fs.cornerLeaves}× maradt`))}
      ${tile('Split', p(fs.splits, fs.leavesKnown), sub(`${fs.splits}× · ${fs.splitsConverted} leütve`))}
    </div>
    ${
      worst.length
        ? `<h3 class="sub-h">Leggyakrabban elhibázott állások</h3>
           <table class="tbl"><thead><tr><th>Állás</th><th>Próba</th><th>Leütve</th></tr></thead><tbody>
           ${worst.map((w) => `<tr><td>${esc(w.key)}</td><td>${w.n}</td><td class="num">${w.made}/${w.n}</td></tr>`).join('')}
           </tbody></table>`
        : ''
    }
  </section>`;
}

function backupBanner(): string {
  const r = backupReminder(getData());
  if (!r) return '';
  const when = r.days === null ? 'Még nem készítettél mentést.' : `${r.days} napja nem mentettél.`;
  return `<section class="card backup-banner" id="backupBanner" role="region" aria-label="Mentési emlékeztető">
    <div><b>${when}</b> <span class="muted">${r.changed} alkalom van csak ezen a telefonon. Ments a Drive-ra vagy az iCloudba.</span></div>
    <div class="backup-actions">
      <button type="button" class="btn btn-primary" id="backupNow">Mentés most</button>
      <button type="button" class="btn btn-ghost" id="backupLater">Később</button>
    </div>
  </section>`;
}

export function renderHome(root: HTMLElement): void {
  const { sessions, settings } = getData();
  const savedId = takeJustSaved();
  if (sessions.length === 0) {
    root.innerHTML = `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">🎳</div>
        <h1>Még nincs adat</h1>
        <p>Rögzítsd az első alkalmat, és itt látod majd az átlagodat és a fejlődésedet.</p>
        <a class="btn btn-primary btn-lg" href="#/uj">Új alkalom</a>
      </div>`;
    return;
  }

  const d = dashboard(sessions);
  const gp = goalProgress(settings.goalAverage, d.last20Avg);
  const tips = coachTips({ sessions, settings, today: todayIso() });
  const corner = settings.profile.hand === 'bal' ? 7 : 10;
  const saved = savedId ? sessions.find((s) => s.id === savedId) : undefined;
  const fb = saved ? sessionFeedback(saved, sessions) : null;
  const change =
    d.last20Change === null
      ? ''
      : `<div class="tile-delta ${d.last20Change >= 0 ? 'up' : 'down'}">${d.last20Change >= 0 ? '▲' : '▼'} ${fmtSigned(d.last20Change)} az előző 20-hoz</div>`;

  root.innerHTML = `
    ${
      fb
        ? `<section class="card feedback fb-${fb.level}" id="feedback">
            <div class="fb-head"><h2>${esc(fb.headline)}</h2>
              <button type="button" class="icon-btn" id="fbClose" aria-label="Visszajelzés bezárása">✕</button></div>
            ${fb.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
          </section>`
        : ''
    }
    ${backupBanner()}
    <section class="hero card">
      <div class="hero-label">Összátlag</div>
      <div class="hero-value">${fmtAvg(d.all.average)}</div>
      <div class="hero-sub">${d.all.count} játék · ${sessions.length} alkalom</div>
    </section>

    ${
      gp
        ? `<section class="card goal">
            <div class="goal-head"><span>Cél: <b>${gp.goal}</b></span><span>Utolsó 20: <b>${fmtAvg(gp.current)}</b></span></div>
            <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${gp.goal}" aria-valuenow="${gp.current.toFixed(1)}">
              <div class="bar-fill" style="width:${(gp.ratio * 100).toFixed(1)}%"></div>
            </div>
            <div class="goal-foot">${gp.gap > 0 ? `Még ${fmtAvg(gp.gap)} pont hiányzik` : 'Elérted a célt! Ideje magasabbra tenni.'}</div>
          </section>`
        : ''
    }

    <section class="card" id="chartCard"></section>

    ${coachCard(tips, d.all.count, [...getData().coachReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])}

    ${frameCard(sessionFrameStats(sessions, corner), corner)}

    <div class="tiles">
      ${tile('Utolsó 20 átlaga', fmtAvg(d.last20Avg), change)}
      ${tile('Edzésátlag', fmtAvg(d.trainingAvg))}
      ${tile('Versenyátlag', fmtAvg(d.competitionAvg))}
      ${tile('Verseny − edzés', fmtSigned(d.competitionMinusTraining))}
      ${tile('Legjobb', fmtInt(d.all.best))}
      ${tile('Legrosszabb', fmtInt(d.all.worst))}
      ${tile('200+', fmtInt(d.all.over200))}
      ${tile('150+', fmtInt(d.all.over150))}
      ${tile('100 alatt', fmtInt(d.all.under100))}
    </div>

    ${groupTable('Golyónként', d.byBall, (k) => k)}
    ${groupTable('Típusonként', d.byType, (k) => typeLabel(k as SessionType))}
  `;

  mountScoreChart(root.querySelector('#chartCard')!, d.games, { goal: settings.goalAverage });
  root.querySelector('#fbClose')?.addEventListener('click', () => root.querySelector('#feedback')?.remove());
  root.querySelector('#backupNow')?.addEventListener('click', async () => {
    if (await saveFile(`bowling-naplo-${todayIso()}.json`, exportJson(getData()), 'application/json')) {
      await updateSettings({ lastExportAt: new Date().toISOString(), backupSnoozeUntil: undefined });
      toast('Mentés elkészült');
      root.querySelector('#backupBanner')?.remove();
    }
  });
  root.querySelector('#backupLater')?.addEventListener('click', async () => {
    await updateSettings({ backupSnoozeUntil: snoozeUntil() });
    root.querySelector('#backupBanner')?.remove();
  });
}
