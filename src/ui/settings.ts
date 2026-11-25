import { cleanKey, getApiKey, maskKey, setApiKey, verifyApiKey } from '../coach/claude';
import { CURRENT_SCHEMA, KIND_LABEL, type FieldBenchmark, type Profile, type SessionTypeDef, type Settings, type TypeKind } from '../domain/types';
import { getData, replaceAll, updateSettings } from '../state';
import {
  csvTemplate,
  exportCsv,
  exportJson,
  fold,
  mergeReports,
  mergeSessions,
  newTypeFromLabel,
  parseImport,
  summarizeImport,
  withNewTypes,
  type ImportResult,
} from '../storage/io';
import { esc, fmtDate, todayIso, uid } from '../util/format';
import { exportBenchmarksCsv, formatCutoffs, mergeBenchmarks, parseCutoffs } from '../storage/fieldIo';
import { saveFile } from './files';
import { applyTheme, toast } from './shell';

/** Hány alkalom használja a típust. */
const typeUsage = (id: string) => getData().sessions.filter((x) => x.type === id).length;

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

    <section class="card form" id="typesCard">
      <h2>Alkalmak típusai</h2>
      <p class="muted small">A kategória dönti el, hova számít: <b>Edzés</b> → edzésátlag, <b>Verseny</b> → versenyátlag, <b>Egyéb</b> → csak az összátlag.</p>
      <ul class="type-list">
        ${s.sessionTypes
          .map((t, i) => {
            const used = typeUsage(t.id);
            return `<li>
              <input class="type-label" data-i="${i}" value="${esc(t.label)}" maxlength="40" aria-label="Típus neve">
              <select class="type-kind" data-i="${i}" aria-label="${esc(t.label)} kategóriája">
                ${(['edzes', 'verseny', 'egyeb'] as TypeKind[]).map((k) => opt(k, KIND_LABEL[k], t.kind)).join('')}
              </select>
              <button type="button" class="icon-btn" data-deltype="${i}" aria-label="${esc(t.label)} törlése"
                ${used || s.sessionTypes.length <= 1 ? 'disabled' : ''} title="${used ? `${used} alkalom használja` : 'Törlés'}">✕</button>
              ${used ? `<span class="type-used">${used} alkalom</span>` : ''}
            </li>`;
          })
          .join('')}
      </ul>
      <div class="type-new">
        <input id="newTypeLabel" placeholder="pl. Csapatbajnokság" maxlength="40" aria-label="Új típus neve">
        <select id="newTypeKind" aria-label="Új típus kategóriája">
          ${(['verseny', 'edzes', 'egyeb'] as TypeKind[]).map((k) => opt(k, KIND_LABEL[k], 'verseny')).join('')}
        </select>
        <button type="button" class="btn" id="addType">Hozzáad</button>
      </div>
      <p class="muted small">Használatban lévő típus nem törölhető, de átnevezhető. A régi alkalmak az új nevet kapják.</p>
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

    <section class="card form" id="fieldCard">
      <h2>Korábbi versenyek pontjai</h2>
      <p class="muted small">Melyik helyezéshez hány pont kellett. Ebből becsüli az app az esélyedet a „Verseny előtt” oldalon.</p>
      <ul class="bench-list">
        ${[...(getData().benchmarks ?? [])]
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.category.localeCompare(b.category))
          .map((b) => `<li><div><b>${esc(b.series)} ${esc(b.event)}</b> <span class="tag">${b.category === 'csapat' ? 'csapat' : 'egyéni'}</span>
              <div class="muted small">${esc(formatCutoffs(b.cutoffs))}${b.own ? ` · saját: ${b.own.total}${b.own.rank ? ` (${b.own.rank}.)` : ''}` : ''}</div></div>
              <div class="bench-btns"><button type="button" class="btn btn-ghost" data-bedit="${esc(b.id)}">Szerkeszt</button>
              <button type="button" class="icon-btn" data-bdel="${esc(b.id)}" aria-label="Törlés">✕</button></div></li>`)
          .join('')}
      </ul>
      <div id="benchForm"></div>
      <div class="btn-col">
        <button type="button" class="btn" id="benchNew">+ Új verseny</button>
        <button type="button" class="btn btn-ghost" id="benchCsv">Versenyek letöltése (CSV)</button>
      </div>
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
               <input id="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" autocapitalize="off" autocorrect="off"></div>
             <button type="button" class="btn btn-primary" id="saveKey">Kulcs mentése</button>
             <div id="keyStatus" role="status" aria-live="polite"></div>`
      }
      <p class="muted small">A kulcs csak ezen az eszközön tárolódik, a mentésekbe (export) nem kerül bele. Állíts be havi költési limitet a Console-ban.</p>
    </section>

    <section class="card"><h2>Nem értesz egy szót?</h2><a class="claude-link" href="#/szotar"><span><b>Szótár</b><span class="muted"> · minden szó egyszerűen</span></span><span aria-hidden="true">›</span></a></section>

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

  // Típusok: átnevezés, kategória, törlés, új típus.
  const types = () => getData().settings.sessionTypes;
  const saveTypes = async (list: SessionTypeDef[], msg: string) => {
    await updateSettings({ sessionTypes: list });
    toast(msg);
  };
  root.querySelectorAll<HTMLInputElement>('.type-label').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const i = Number(inp.dataset.i);
      const label = inp.value.trim();
      if (!label) {
        inp.value = types()[i].label;
        toast('A típus neve nem lehet üres.', true);
        return;
      }
      if (types().some((t, k) => k !== i && fold(t.label) === fold(label))) {
        inp.value = types()[i].label;
        toast('Már van ilyen nevű típus.', true);
        return;
      }
      await saveTypes(types().map((t, k) => (k === i ? { ...t, label } : t)), 'Típus átnevezve');
    }),
  );
  root.querySelectorAll<HTMLSelectElement>('.type-kind').forEach((sel) =>
    sel.addEventListener('change', async () => {
      const i = Number(sel.dataset.i);
      await saveTypes(types().map((t, k) => (k === i ? { ...t, kind: sel.value as TypeKind } : t)), 'Kategória mentve');
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-deltype]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.deltype);
      if (typeUsage(types()[i].id) || types().length <= 1) return;
      await saveTypes(types().filter((_, k) => k !== i), 'Típus törölve');
      renderSettings(root);
    }),
  );
  const addType = async () => {
    const label = val('newTypeLabel');
    if (!label) return;
    if (types().some((t) => fold(t.label) === fold(label))) {
      toast('Már van ilyen nevű típus.', true);
      return;
    }
    const def = { ...newTypeFromLabel(label, types()), kind: val('newTypeKind') as TypeKind };
    await saveTypes([...types(), def], `„${label}” hozzáadva`);
    renderSettings(root);
  };
  root.querySelector('#addType')!.addEventListener('click', addType);
  root.querySelector('#newTypeLabel')!.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') addType();
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

  root.querySelector('#saveKey')?.addEventListener('click', async () => {
    const btn = root.querySelector<HTMLButtonElement>('#saveKey')!;
    const status = root.querySelector<HTMLElement>('#keyStatus')!;
    const k = cleanKey(root.querySelector<HTMLInputElement>('#apiKey')!.value);
    if (!k) return;
    if (!k.startsWith('sk-ant-')) {
      status.innerHTML = `<div class="import-box error">Ez nem Anthropic-kulcs: az Anthropic kulcsai „sk-ant-” kezdetűek. Lehet, hogy csak egy része került a vágólapra.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Ellenőrzés…';
    status.innerHTML = '';
    const res = await verifyApiKey(k);
    btn.disabled = false;
    btn.textContent = 'Kulcs mentése';
    if (res.ok) {
      setApiKey(k);
      toast('API-kulcs ellenőrizve és mentve');
      renderSettings(root);
      return;
    }
    if (res.reason === 'offline') {
      // Internet nélkül is elmenthető; az első elemzéskor derül ki, jó-e.
      setApiKey(k);
      toast('Kulcs mentve, de nem tudtam ellenőrizni (nincs kapcsolat)');
      renderSettings(root);
      return;
    }
    status.innerHTML = `<div class="import-box error">${esc(res.message)}</div>`;
  });
  root.querySelector('#delKey')?.addEventListener('click', () => {
    if (!confirm('Törlöd az API-kulcsot erről az eszközről? Az edzőnapló bejegyzései megmaradnak.')) return;
    setApiKey(null);
    toast('API-kulcs törölve');
    renderSettings(root);
  });

  // Mezőny-határok: szerkesztés, új, törlés, CSV export.
  const benchForm = root.querySelector<HTMLElement>('#benchForm')!;
  const openBench = (b?: FieldBenchmark) => {
    const v: FieldBenchmark = b ?? { id: '', series: 'Hivatal Kupa', event: '', date: todayIso(), category: 'egyeni', qualifyRank: 12, cutoffs: [] };
    benchForm.innerHTML = `<div class="import-box">
      <div class="row2">
        <div class="field"><label class="field-label" for="bSeries">Sorozat</label><input id="bSeries" value="${esc(v.series)}"></div>
        <div class="field"><label class="field-label" for="bEvent">Verseny</label><input id="bEvent" value="${esc(v.event)}" placeholder="pl. XXVI (2027 tavasz)"></div>
      </div>
      <div class="row2">
        <div class="field"><label class="field-label" for="bDate">Dátum</label><input id="bDate" type="date" value="${esc(v.date ?? '')}"></div>
        <div class="field"><label class="field-label" for="bCat">Kategória</label><select id="bCat">${opt('egyeni', 'Egyéni', v.category)}${opt('csapat', 'Csapat', v.category)}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label class="field-label" for="bEntrants">Indulók / csapatok</label><input id="bEntrants" inputmode="numeric" value="${esc(v.entrants)}"></div>
        <div class="field"><label class="field-label" for="bQual">Továbbjut (top)</label><input id="bQual" inputmode="numeric" value="${esc(v.qualifyRank)}"></div>
      </div>
      <div class="field"><label class="field-label" for="bCuts">Pontok <span class="hint">helyezés=pont, vesszővel</span></label>
        <input id="bCuts" value="${esc(formatCutoffs(v.cutoffs))}" placeholder="1=409, 3=332, 12=297, 13=292"></div>
      <div class="row2">
        <div class="field"><label class="field-label" for="bOwn">Saját összeg</label><input id="bOwn" inputmode="numeric" value="${esc(v.own?.total)}"></div>
        <div class="field"><label class="field-label" for="bOwnRank">Saját hely</label><input id="bOwnRank" inputmode="numeric" value="${esc(v.own?.rank)}"></div>
      </div>
      <div class="btn-col"><button type="button" class="btn btn-primary" id="bSave">Mentés</button><button type="button" class="btn btn-ghost" id="bCancel">Mégse</button></div>
    </div>`;
    benchForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    benchForm.querySelector('#bCancel')!.addEventListener('click', () => (benchForm.innerHTML = ''));
    benchForm.querySelector('#bSave')!.addEventListener('click', async () => {
      const intOr = (id: string) => {
        const t = val(id);
        return t === '' ? undefined : /^\d+$/.test(t) ? Number(t) : NaN;
      };
      const cutoffs = parseCutoffs(val('bCuts'));
      const qual = intOr('bQual');
      const ownTotal = intOr('bOwn');
      if (!val('bEvent')) return toast('Add meg a verseny nevét.', true);
      if (!cutoffs) return toast('A határok formátuma: hely=összeg, vesszővel (pl. 1=409, 12=297).', true);
      if (!qual || Number.isNaN(qual)) return toast('Add meg, hányadik helyig jut tovább a mezőny.', true);
      if ([intOr('bEntrants'), ownTotal, intOr('bOwnRank')].some((x) => Number.isNaN(x))) return toast('Az indulók, a saját összeg és a hely csak szám lehet.', true);
      const next: FieldBenchmark = {
        id: v.id || uid(),
        series: val('bSeries') || 'Verseny',
        event: val('bEvent'),
        date: val('bDate') || undefined,
        category: val('bCat') as FieldBenchmark['category'],
        entrants: intOr('bEntrants'),
        qualifyRank: qual,
        cutoffs,
        own: ownTotal !== undefined ? { total: ownTotal, rank: intOr('bOwnRank') } : undefined,
      };
      const list = getData().benchmarks ?? [];
      const i = list.findIndex((x) => x.id === next.id);
      await replaceAll({ ...getData(), benchmarks: i >= 0 ? list.map((x, k) => (k === i ? next : x)) : [...list, next] });
      toast('Mezőny-határ mentve');
      renderSettings(root);
    });
  };
  root.querySelector('#benchNew')!.addEventListener('click', () => openBench());
  root.querySelectorAll<HTMLButtonElement>('[data-bedit]').forEach((btn) =>
    btn.addEventListener('click', () => openBench((getData().benchmarks ?? []).find((b) => b.id === btn.dataset.bedit))),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-bdel]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const b = (getData().benchmarks ?? []).find((x) => x.id === btn.dataset.bdel);
      if (!b || !confirm(`Törlöd: ${b.series} ${b.event} (${b.category === 'csapat' ? 'csapat' : 'egyéni'})?`)) return;
      await replaceAll({ ...getData(), benchmarks: (getData().benchmarks ?? []).filter((x) => x.id !== b.id) });
      renderSettings(root);
    }),
  );
  root.querySelector('#benchCsv')!.addEventListener('click', () =>
    saveFile(`mezony-hatarok-${todayIso()}.csv`, exportBenchmarksCsv(getData().benchmarks ?? []), 'text/csv;charset=utf-8'),
  );

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
  const bmerge = mergeBenchmarks(data.benchmarks ?? [], res.benchmarks);
  if (sum.sessions === 0 && res.benchmarks.length > 0) {
    box.innerHTML = `<div class="import-box"><b>${esc(fileName)}</b>
      <p><b>${res.benchmarks.length}</b> verseny mezőny-határai: ${bmerge.added} új, ${bmerge.updated} frissül.</p>
      ${res.warnings.length ? `<p class="muted small">${res.warnings.length} figyelmeztetés: ${esc(res.warnings.slice(0, 3).join(' '))}</p>` : ''}
      <div class="btn-col"><button type="button" class="btn btn-primary" id="impBench">Betöltés</button><button type="button" class="btn btn-ghost" id="impCancel">Mégse</button></div></div>`;
    box.querySelector('#impCancel')!.addEventListener('click', () => (box.innerHTML = ''));
    box.querySelector('#impBench')!.addEventListener('click', async () => {
      await replaceAll({ ...data, benchmarks: bmerge.list });
      toast(`Mezőny-határok betöltve: ${bmerge.added} új, ${bmerge.updated} frissítve`);
      renderSettings(root);
    });
    return;
  }
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
        <li><b>${sum.sessions}</b> alkalom, <b>${sum.games}</b> játék${sum.withFrames ? ` (${sum.withFrames} dobásonként rögzítve)` : ''}${res.coachReports.length ? `, ${res.coachReports.length} edzői elemzés` : ''}</li>
        <li>${esc(fmtDate(sum.from!))} – ${esc(fmtDate(sum.to!))}</li>
        <li>Hozzáadásnál: <b>${merge.added}</b> új, <b>${merge.updated}</b> frissül, <b>${merge.skipped}</b> már megvan</li>
        ${res.benchmarks.length ? `<li>Mezőny-határok: ${res.benchmarks.length} verseny (${bmerge.added} új, ${bmerge.updated} frissül)</li>` : ''}
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
  // A fájlban szereplő új típusok mindkét esetben bekerülnek a listába.
  const settingsFor = () =>
    withNewTypes(takeSettings() && res.settings ? { ...res.settings, lastExportAt: data.settings.lastExportAt } : data.settings, res.newTypes);

  box.querySelector('#impCancel')!.addEventListener('click', () => (box.innerHTML = ''));
  box.querySelector('#impMerge')!.addEventListener('click', async () => {
    await replaceAll({ ...data, schemaVersion: CURRENT_SCHEMA, sessions: merge.sessions, settings: settingsFor(), coachReports: mergeReports(data.coachReports, res.coachReports), benchmarks: bmerge.list });
    toast(`Import kész: ${merge.added} új, ${merge.updated} frissítve`);
    applyTheme(getData().settings.theme);
    renderSettings(root);
  });
  box.querySelector('#impReplace')!.addEventListener('click', async () => {
    const n = data.sessions.length;
    if (n > 0 && !confirm(`A jelenlegi ${n} alkalom törlődik, és a fájl tartalma kerül a helyére. Ez nem vonható vissza. Biztos vagy benne? (Előtte érdemes menteni.)`)) return;
    await replaceAll({ ...data, schemaVersion: CURRENT_SCHEMA, sessions: res.sessions, settings: settingsFor(), coachReports: res.coachReports, benchmarks: res.benchmarks.length ? res.benchmarks : (data.benchmarks ?? []) });
    toast(`Adatok lecserélve: ${res.sessions.length} alkalom`);
    applyTheme(getData().settings.theme);
    renderSettings(root);
  });
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
