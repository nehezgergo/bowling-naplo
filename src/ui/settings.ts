import { getApiKey, maskKey, setApiKey } from '../coach/claude';
import type { Profile, Settings } from '../domain/types';
import { getData, replaceAll, updateSettings } from '../state';
import {
  csvTemplate,
  exportCsv,
  exportJson,
  mergeReports,
  mergeSessions,
  parseImport,
  summarizeImport,
  type ImportResult,
} from '../storage/io';
import { esc, fmtDate, todayIso, uid } from '../util/format';
import { applyTheme, toast } from './shell';

const opt = (value: string, label: string, cur: string | undefined) =>
  `<option value="${esc(value)}"${value === (cur ?? '') ? ' selected' : ''}>${esc(label)}</option>`;

export function renderSettings(root: HTMLElement): void {
  const s = getData().settings;
  const p = s.profile;
  const apiKey = getApiKey();

  root.innerHTML = `
    <h1 class="page-title">Beállítások</h1>

    <section class="card form">
      <h2>Cél</h2>
      <div class="field">
        <label class="field-label" for="goal">Célátlag</label>
        <input id="goal" inputmode="numeric" maxlength="3" value="${esc(s.goalAverage)}" placeholder="pl. 150">
      </div>
    </section>

    <section class="card form">
      <h2>Golyók</h2>
      <ul class="ball-list" id="ballList">
        ${s.balls.map((b, i) => `<li><span>${esc(b)}</span><button type="button" class="icon-btn" data-del="${i}" aria-label="${esc(b)} törlése">✕</button></li>`).join('')}
      </ul>
      <div class="inline">
        <input id="newBall" placeholder="pl. 13 lb reaktív" aria-label="Új golyó neve">
        <button type="button" class="btn" id="addBall">Hozzáad</button>
      </div>
    </section>

    <section class="card form">
      <h2>Profil <span class="hint">az edzőnek</span></h2>
      <div class="row2">
        <div class="field"><label class="field-label" for="hand">Kéz</label>
          <select id="hand">${opt('', '–', p.hand)}${opt('jobb', 'Jobbkezes', p.hand)}${opt('bal', 'Balkezes', p.hand)}</select></div>
        <div class="field"><label class="field-label" for="style">Stílus</label>
          <select id="style">${opt('', '–', p.style)}${opt('egykezes', 'Egykezes', p.style)}${opt('ketkezes', 'Kétkezes', p.style)}</select></div>
      </div>
      <div class="field"><label class="field-label" for="years">Hány éve bowlingozol?</label>
        <input id="years" inputmode="numeric" value="${esc(p.yearsPlaying)}"></div>
      <div class="field"><label class="field-label" for="ballsDesc">Golyóid részletesen</label>
        <textarea id="ballsDesc" rows="2" placeholder="pl. 12 lb reaktív, ívelő; 11 lb poliészter spare-re">${esc(p.ballsDescription)}</textarea></div>
      <div class="field"><label class="field-label" for="longGoal">Hosszú távú cél</label>
        <input id="longGoal" value="${esc(p.longTermGoal)}" placeholder="pl. 160-as átlag a szezon végére"></div>
    </section>

    <section class="card form" id="claudeCard">
      <h2>Claude-edző <span class="hint">opcionális</span></h2>
      ${
        apiKey
          ? `<p>API-kulcs beállítva: <code>${esc(maskKey(apiKey))}</code></p>
             <div class="btn-col"><a class="btn btn-primary" href="#/edzo">Edzőnapló megnyitása</a>
             <button type="button" class="btn btn-ghost danger-text" id="delKey">Kulcs törlése erről az eszközről</button></div>`
          : `<p class="muted">Személyre szabott elemzéshez a saját Anthropic API-kulcsod kell (console.anthropic.com → API Keys). A claude.ai előfizetés ezt nem tartalmazza. Egy elemzés kb. 5–15 cent.</p>
             <div class="field"><label class="field-label" for="apiKey">API-kulcs</label>
               <input id="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-api03-…"></div>
             <button type="button" class="btn btn-primary" id="saveKey">Kulcs mentése</button>`
      }
      <p class="muted small">A kulcs csak ezen az eszközön tárolódik, a mentésekbe (export) nem kerül bele. Állíts be havi költési limitet a Console-ban.</p>
    </section>

    <section class="card form">
      <h2>Megjelenés</h2>
      <div class="field"><label class="field-label" for="theme">Téma</label>
        <select id="theme">${opt('auto', 'Rendszer szerint', s.theme)}${opt('light', 'Világos', s.theme)}${opt('dark', 'Sötét', s.theme)}</select></div>
    </section>

    <section class="card form" id="dataCard">
      <h2>Adatok</h2>
      <p class="muted">Az adataid csak ezen az eszközön vannak. Ments rendszeresen, és a mentéssel tudod átvinni őket másik eszközre is.
        <br><b>${s.lastExportAt ? `Utolsó mentés: ${esc(fmtDateTime(s.lastExportAt))}` : 'Még nem mentettél.'}</b></p>
      <div class="btn-col">
        <button type="button" class="btn btn-primary" id="exportJson">Teljes mentés (JSON)</button>
        <button type="button" class="btn" id="exportCsv">Export Excelbe (CSV)</button>
        <label class="btn" for="importFile">Importálás fájlból…</label>
        <input type="file" id="importFile" accept=".json,.csv,.txt,application/json,text/csv" class="visually-hidden">
        <button type="button" class="btn btn-ghost" id="template">CSV minta a korábbi eredményeidhez</button>
      </div>
      <p class="muted small">A JSON mindent tartalmaz (frame-adatot is). A CSV Excelben megnyitható, de a frame-részletek nincsenek benne.</p>
      <div id="importPreview"></div>
    </section>

    <p class="muted center">Bowling Napló · ${getData().sessions.length} alkalom tárolva ezen az eszközön</p>
  `;

  const val = (id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)!.value.trim();

  const saveProfile = async () => {
    const years = val('years');
    const profile: Profile = {
      hand: (val('hand') || undefined) as Profile['hand'],
      style: (val('style') || undefined) as Profile['style'],
      yearsPlaying: years === '' || Number.isNaN(Number(years)) ? undefined : Number(years),
      ballsDescription: val('ballsDesc') || undefined,
      longTermGoal: val('longGoal') || undefined,
    };
    await updateSettings({ profile });
    toast('Profil mentve');
  };
  ['hand', 'style', 'years', 'ballsDesc', 'longGoal'].forEach((id) =>
    root.querySelector(`#${id}`)!.addEventListener('change', saveProfile),
  );

  root.querySelector('#goal')!.addEventListener('change', async () => {
    const v = val('goal');
    const n = Number(v);
    if (v !== '' && (!Number.isInteger(n) || n < 1 || n > 300)) {
      toast('A célátlag 1 és 300 közötti egész szám legyen.', true);
      return;
    }
    await updateSettings({ goalAverage: v === '' ? undefined : n });
    toast('Cél mentve');
  });

  root.querySelector('#theme')!.addEventListener('change', async () => {
    const theme = val('theme') as Settings['theme'];
    await updateSettings({ theme });
    applyTheme(theme);
  });

  const addBall = async () => {
    const name = val('newBall');
    if (!name) return;
    if (s.balls.includes(name)) {
      toast('Ez a golyó már szerepel.', true);
      return;
    }
    await updateSettings({ balls: [...s.balls, name] });
    renderSettings(root);
  };
  root.querySelector('#addBall')!.addEventListener('click', addBall);
  root.querySelector('#newBall')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') addBall();
  });
  root.querySelector('#ballList')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del]');
    if (!btn) return;
    const balls = s.balls.filter((_, i) => i !== Number(btn.dataset.del));
    await updateSettings({ balls });
    renderSettings(root);
  });

  root.querySelector('#saveKey')?.addEventListener('click', () => {
    const k = val('apiKey');
    if (!k) return;
    if (!/^sk-ant-api\d*-/.test(k)) {
      toast('Ez nem API-kulcsnak tűnik. A Console-ban készült kulcs „sk-ant-api…” kezdetű.', true);
      return;
    }
    setApiKey(k);
    toast('API-kulcs mentve ezen az eszközön');
    renderSettings(root);
  });
  root.querySelector('#delKey')?.addEventListener('click', () => {
    if (!confirm('Törlöd az API-kulcsot erről az eszközről? Az edzőnapló bejegyzései megmaradnak.')) return;
    setApiKey(null);
    toast('API-kulcs törölve');
    renderSettings(root);
  });

  const markExported = async () => {
    await updateSettings({ lastExportAt: new Date().toISOString() });
    renderSettings(root);
  };

  root.querySelector('#exportJson')!.addEventListener('click', async () => {
    if (await saveFile(`bowling-naplo-${todayIso()}.json`, exportJson(getData()), 'application/json')) await markExported();
  });
  root.querySelector('#exportCsv')!.addEventListener('click', async () => {
    if (await saveFile(`bowling-naplo-${todayIso()}.csv`, exportCsv(getData().sessions), 'text/csv;charset=utf-8')) await markExported();
  });
  root.querySelector('#template')!.addEventListener('click', () => {
    saveFile('bowling-minta.csv', csvTemplate(), 'text/csv;charset=utf-8');
  });

  const fileInput = root.querySelector<HTMLInputElement>('#importFile')!;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let res: ImportResult;
    try {
      res = parseImport(file.name, await file.text(), uid);
    } catch (err) {
      showPreviewError(root, err instanceof Error ? err.message : 'A fájlt nem sikerült beolvasni.');
      return;
    }
    showPreview(root, file.name, res);
  });
}

function showPreviewError(root: HTMLElement, msg: string) {
  const box = root.querySelector<HTMLElement>('#importPreview')!;
  box.innerHTML = `<div class="import-box error"><b>Nem sikerült az import.</b><p>${esc(msg)}</p></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showPreview(root: HTMLElement, fileName: string, res: ImportResult) {
  const box = root.querySelector<HTMLElement>('#importPreview')!;
  const data = getData();
  const sum = summarizeImport(res.sessions);
  if (sum.sessions === 0) {
    showPreviewError(root, `Nem találtam importálható alkalmat.${res.warnings.length ? ' ' + res.warnings.slice(0, 3).join(' ') : ''}`);
    return;
  }
  const merge = mergeSessions(data.sessions, res.sessions);
  const shownWarnings = res.warnings.slice(0, 8);
  box.innerHTML = `
    <div class="import-box">
      <b>${esc(fileName)}</b>
      <ul class="import-sum">
        <li><b>${sum.sessions}</b> alkalom, <b>${sum.games}</b> játék${sum.withFrames ? ` (${sum.withFrames} frame-adattal)` : ''}${res.coachReports.length ? `, ${res.coachReports.length} edzői elemzés` : ''}</li>
        <li>${esc(fmtDate(sum.from!))} – ${esc(fmtDate(sum.to!))}</li>
        <li>Hozzáadásnál: <b>${merge.added}</b> új, <b>${merge.updated}</b> frissül, <b>${merge.skipped}</b> már megvan</li>
      </ul>
      ${
        res.warnings.length
          ? `<details class="import-warn"><summary>${res.warnings.length} figyelmeztetés</summary><ul>${shownWarnings
              .map((w) => `<li>${esc(w)}</li>`)
              .join('')}${res.warnings.length > shownWarnings.length ? `<li>…és még ${res.warnings.length - shownWarnings.length}</li>` : ''}</ul></details>`
          : ''
      }
      ${res.settings ? '<label class="check"><input type="checkbox" id="takeSettings"> A beállítások és a profil átvétele is</label>' : ''}
      <div class="btn-col">
        <button type="button" class="btn btn-primary" id="impMerge" ${merge.added + merge.updated === 0 ? 'disabled' : ''}>Hozzáadás (${merge.added + merge.updated})</button>
        <button type="button" class="btn btn-danger" id="impReplace">Minden adat lecserélése</button>
        <button type="button" class="btn btn-ghost" id="impCancel">Mégse</button>
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const takeSettings = () => !!box.querySelector<HTMLInputElement>('#takeSettings')?.checked;
  const settingsFor = () => (takeSettings() && res.settings ? { ...res.settings, lastExportAt: data.settings.lastExportAt } : data.settings);

  box.querySelector('#impCancel')!.addEventListener('click', () => (box.innerHTML = ''));
  box.querySelector('#impMerge')!.addEventListener('click', async () => {
    await replaceAll({ schemaVersion: 1, sessions: merge.sessions, settings: settingsFor(), coachReports: mergeReports(data.coachReports, res.coachReports) });
    toast(`Import kész: ${merge.added} új, ${merge.updated} frissítve`);
    applyTheme(getData().settings.theme);
    renderSettings(root);
  });
  box.querySelector('#impReplace')!.addEventListener('click', async () => {
    const n = data.sessions.length;
    if (n > 0 && !confirm(`A jelenlegi ${n} alkalom törlődik, és a fájl tartalma kerül a helyére. Ez nem vonható vissza. Biztos vagy benne? (Előtte érdemes menteni.)`)) return;
    await replaceAll({ schemaVersion: 1, sessions: res.sessions, settings: settingsFor(), coachReports: res.coachReports });
    toast(`Adatok lecserélve: ${res.sessions.length} alkalom`);
    applyTheme(getData().settings.theme);
    renderSettings(root);
  });
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Fájl mentése. Telefonon a megosztás menüt nyitja (Fájlok, Drive, e-mail),
 * máshol letölti. Igazzal tér vissza, ha a mentés elindult.
 */
async function saveFile(name: string, content: string, mime: string): Promise<boolean> {
  const file = new File([content], name, { type: mime });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return false;
      /* ha a megosztás nem megy, letöltés */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
