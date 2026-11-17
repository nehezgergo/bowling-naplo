import { coachTips, nextFocus, sessionFeedback, type CoachTip } from '../coach/rules';
import { avgFirstBall, leaveTable, sessionFrameStats, type FrameStats, type LeaveRow } from '../domain/scoring';
import { oneAction } from '../coach/oneAction';
import { coldStart } from '../domain/coldstart';
import { dashboard, goalProgress, type GroupAvg } from '../domain/stats';
import { typeLabel, type CoachReport, type SessionType } from '../domain/types';
import { getData, updateSettings } from '../state';
import { backupReminder, snoozeUntil } from '../storage/backup';
import { exportJson } from '../storage/io';
import { esc, fmtAvg, fmtDate, fmtInt, fmtRate, fmtSigned, todayIso } from '../util/format';
import { mountScoreChart } from './chart';
import { saveFile } from './files';
import { discardDraft, pendingDraft } from './newSession';
import { coldRow, coldTable } from './prepPage';
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

/** Arány-csempe: kis mintánál (n < 10) a darabszám a fő érték, nem a százalék. */
const rateTile = (label: string, made: number, n: number) => {
  const big = n === 0 ? '–' : n < 10 ? `${made}/${n}` : `${Math.round((made / n) * 100)}%`;
  const small = n === 0 ? 'nincs adat' : n < 10 ? 'kevés adat' : `${made}/${n}`;
  return tile(label, big, `<div class="tile-sub">${small}</div>`);
};

function directionBlock(fs: FrameStats): string {
  const d = fs.dir;
  const tagged = d.zseb + d.bal + d.jobb;
  if (tagged === 0) return `<p class="muted small">Az első dobás irányát (zseb / balra / jobbra) a frame-bevitelnél egy koppintással jelölheted.</p>`;
  // A jelöletlen strike zsebnek számít.
  const zseb = d.zseb + d.strike;
  const total = zseb + d.bal + d.jobb;
  const bar = (label: string, v: number, cls: string) =>
    `<div class="dir-row"><span>${label}</span><div class="dir-bar"><i class="${cls}" style="width:${((v / total) * 100).toFixed(1)}%"></i></div><b>${total < 10 ? v : `${Math.round((v / total) * 100)}%`}</b></div>`;
  return `<h3 class="sub-h">Első dobás <span class="hint">${total} dobás${d.strike ? ', a strike zsebnek számít' : ''}${d.none ? `; ${d.none} jelöletlen` : ''}</span></h3>
    ${bar('Balra', d.bal, 'k-bal')}${bar('Zseb', zseb, 'k-zseb')}${bar('Jobbra', d.jobb, 'k-jobb')}`;
}

function frameCard(fs: FrameStats, corner: number): string {
  if (fs.games === 0)
    return `<section class="card"><h2>Frame-statisztika</h2><p class="muted">Egy játék sorában a ▦ gombbal frame-enként, bábu-ábrával is rögzíthetsz. Ebből számolom a strike-, spare- és split-arányt.</p></section>`;
  const rows = leaveTable(fs);
  const shown = rows.slice(0, 8);
  const rowHtml = (r: LeaveRow) => `<tr class="${r.worst ? 'worst' : ''}">
      <td>${esc(r.key)}${r.split ? ' <span class="tag">split</span>' : ''}${r.worst ? ' <span class="tag tag-bad">legtöbb pin</span>' : ''}</td>
      <td class="num">${esc(fmtRate(r.made, r.n))}</td>
      <td class="num">${r.missed ? `−${Math.round(r.lostPins)}` : '0'}</td></tr>`;
  return `<section class="card">
    <h2>Frame-statisztika <span class="hint">${fs.games} részletes játék</span></h2>
    <div class="tiles tiles-in">
      ${rateTile('Strike', fs.strikes, fs.strikeChances)}
      ${rateTile('Spare', fs.spares, fs.spareChances)}
      ${tile('Nyitott / játék', fmtAvg(fs.opens / fs.games))}
      ${rateTile('Egy bábus', fs.singlePinSpares, fs.singlePinChances)}
      ${rateTile('Több bábus', fs.multiPinSpares, fs.multiPinChances)}
      ${rateTile(`${corner}-es bábu`, fs.cornerSpares, fs.cornerLeaves)}
      ${tile('Split', fs.leavesKnown < 10 ? `${fs.splits}/${fs.leavesKnown}` : `${Math.round((fs.splits / fs.leavesKnown) * 100)}%`, `<div class="tile-sub">${fs.splits}× · ${fs.splitsConverted} leütve</div>`)}
    </div>
    ${
      rows.length
        ? `<h3 class="sub-h">Spare-állások <span class="hint">gyakoriság szerint</span></h3>
           <table class="tbl leave-tbl"><thead><tr><th>Állás</th><th>Leütve</th><th>Pin</th></tr></thead><tbody>
           ${shown.map(rowHtml).join('')}</tbody></table>
           ${rows.length > shown.length ? `<details class="tips-more"><summary>Mind a(z) ${rows.length} állás</summary><table class="tbl leave-tbl"><tbody>${rows.slice(8).map(rowHtml).join('')}</tbody></table></details>` : ''}
           <p class="muted small">„Pin”: becsült veszteség a kihagyásokból (bent maradt bábuk + elmaradt spare-bónusz, átlagosan ${fmtAvg(avgFirstBall(fs))} pin/kihagyás).</p>`
        : '<p class="muted small">Bábu-ábrával rögzített állás még nincs.</p>'
    }
    ${directionBlock(fs)}
  </section>`;
}

function pendingBanner(): string {
  const p = pendingDraft();
  if (!p) return '';
  const stepLabel = p.step === 3 ? 'összegzésnél' : p.step === 2 ? 'játékoknál' : 'körülményeknél';
  return `<section class="card pending-banner" id="pendingBanner">
    <div><b>Folyamatban lévő alkalom</b><div class="muted small">${esc(fmtDate(p.date))} · ${esc(p.type)} · ${p.games} játék · a ${stepLabel} tartasz</div></div>
    <div class="backup-actions">
      <a class="btn btn-primary" href="#/uj">Folytatás</a>
      <button type="button" class="btn btn-ghost" id="pendingDiscard">Elvetés</button>
    </div>
  </section>`;
}

function oneActionCard(): string {
  const { sessions, settings } = getData();
  const a = oneAction(sessions, settings.profile);
  return `<section class="card one-action" aria-label="Egy teendő">
    <div class="focus-label">Egy teendő a következő edzésre</div>
    <p class="one-action-text">${esc(a.text)}</p>
    <div class="one-action-src">${esc(a.source)}${a.lossPerGame !== null ? ` · becsült veszteség kb. ${fmtAvg(a.lossPerGame)} pin/játék` : ''}</div>
  </section>`;
}

function coldCard(): string {
  const { sessions } = getData();
  const comp = coldStart(sessions, 'verseny');
  const train = coldStart(sessions, 'edzes');
  if (comp.n + train.n === 0) return '';
  return `<section class="card">
    <h2>Hidegindítás <span class="hint">1. vs 2. játék</span></h2>
    ${coldTable(coldRow('Verseny', comp) + coldRow('Edzés', train))}
    <a class="claude-link" href="#/verseny-elott"><span><b>Verseny előtt</b><span class="muted"> · bemelegítés, ami bevált</span></span><span aria-hidden="true">›</span></a>
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
    ${pendingBanner()}
    ${oneActionCard()}
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

    ${coldCard()}

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
  root.querySelector('#pendingDiscard')?.addEventListener('click', () => {
    if (!confirm('Elveted a félbehagyott alkalmat? A beírt játékok elvesznek.')) return;
    discardDraft();
    root.querySelector('#pendingBanner')?.remove();
  });
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
