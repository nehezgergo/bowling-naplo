import { getApiKey, requestCoachAdvice } from '../coach/claude';
import type { CoachReport } from '../domain/types';
import { addCoachReport, deleteCoachReport, getData } from '../state';
import { esc, todayIso } from '../util/format';
import { explain } from './glossary';
import { toast } from './shell';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const fmtUsd = (n: number) => `${n < 0.01 ? '<0,01' : n.toLocaleString('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

function reportHtml(r: CoachReport, open: boolean): string {
  const a = r.advice;
  return `<article class="card report">
    <details ${open ? 'open' : ''}>
      <summary>
        <div><div class="report-date">${esc(fmtWhen(r.createdAt))}</div>
        <div class="report-goal">Cél: ${esc(a.nextGoal.metric)}: <b>${esc(a.nextGoal.target)}</b></div></div>
      </summary>
      ${r.question ? `<p class="report-q">Kérdésed: „${esc(r.question)}”</p>` : ''}
      <p class="report-summary">${explain(a.summary)}</p>
      ${a.previousAdviceReview ? `<h3>Az előző tanácsok óta</h3><p>${explain(a.previousAdviceReview)}</p>` : ''}
      ${a.strengths.length ? `<h3>Erősségeid</h3><ul class="report-list">${a.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${
        a.focusAreas.length
          ? `<h3>Fókuszterületek</h3><ol class="report-focus">${a.focusAreas
              .map((f) => `<li><b>${esc(f.title)}</b><div class="muted">${explain(f.why)}</div><div>${explain(f.how)}</div></li>`)
              .join('')}</ol>`
          : ''
      }
      ${
        a.drills.length
          ? `<h3>Gyakorlatok a következő edzésre</h3><ul class="report-drills">${a.drills
              .map((d) => `<li><b>${esc(d.name)}</b> <span class="badge">${esc(d.reps)}</span><div>${explain(d.description)}</div></li>`)
              .join('')}</ul>`
          : ''
      }
      <div class="report-next"><div class="focus-label">Következő cél</div><b>${esc(a.nextGoal.metric)}: ${esc(a.nextGoal.target)}</b><div>${explain(a.nextGoal.why)}</div></div>
      <p class="report-enc">${esc(a.encouragement)}</p>
      <div class="report-foot">
        <span class="muted small">${r.gamesCount} játék alapján${r.usage ? ` · kb. ${fmtUsd(r.usage.costUsd)}` : ''}</span>
        <button type="button" class="btn btn-ghost danger-text" data-del="${esc(r.id)}">Törlés</button>
      </div>
    </details>
  </article>`;
}

export function renderCoachPage(root: HTMLElement): void {
  const { sessions, coachReports } = getData();
  const apiKey = getApiKey();
  const reports = [...coachReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const games = sessions.reduce((a, s) => a + s.games.length, 0);
  const latest = reports[0];
  const newSince = latest ? sessions.filter((s) => s.date > latest.lastSessionDate).length : sessions.length;

  root.innerHTML = `
    <h1 class="page-title">Edzőnapló</h1>
    <section class="card form">
      <h2>Új elemzés kérése</h2>
      ${
        !apiKey
          ? `<p class="muted">A Claude-edzőhöz add meg a saját Anthropic API-kulcsodat a Beállításokban.</p><a class="btn btn-primary" href="#/beallitasok">Beállítások</a>`
          : games < 5
            ? `<p class="muted">Rögzíts legalább 5 játékot, hogy legyen miből dolgoznia az edzőnek.</p>`
            : `<p class="muted">Az edző megkapja a statisztikádat, az utolsó 10 alkalmat a megjegyzéseiddel és a korábbi tanácsait.
                 ${latest ? `Az utolsó elemzés óta <b>${newSince}</b> új alkalom van.` : ''}</p>
               <div class="field"><label class="field-label" for="question">Kérdésed <span class="hint">nem kötelező</span></label>
                 <textarea id="question" rows="2" maxlength="600" placeholder="pl. Mire figyeljek a szombati versenyen? Miért marad meg mindig a 10-es?"></textarea></div>
               <button type="button" class="btn btn-primary btn-lg" id="ask">Elemzés kérése</button>
               <div class="ask-status" id="askStatus" role="status" aria-live="polite"></div>
               <p class="muted small">Kb. 5–15 cent / elemzés, a saját API-keretedből. Internet kell hozzá.</p>`
      }
    </section>
    <div id="reports">${reports.length ? reports.map((r, i) => reportHtml(r, i === 0)).join('') : '<p class="muted center">Még nincs edzői elemzés.</p>'}</div>`;

  const askBtn = root.querySelector<HTMLButtonElement>('#ask');
  const status = root.querySelector<HTMLElement>('#askStatus');
  let controller: AbortController | null = null;

  askBtn?.addEventListener('click', async () => {
    if (controller) {
      controller.abort();
      return;
    }
    if (!navigator.onLine) {
      toast('Nincs internetkapcsolat. Az elemzéshez internet kell.', true);
      return;
    }
    const question = root.querySelector<HTMLTextAreaElement>('#question')!.value;
    controller = new AbortController();
    const started = Date.now();
    let chars = 0;
    askBtn.textContent = 'Megszakítás';
    askBtn.classList.replace('btn-primary', 'btn-danger');
    const tick = () => {
      const sec = Math.round((Date.now() - started) / 1000);
      status!.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${chars ? 'Az edző írja a választ…' : 'Az edző elemzi az adataidat…'} ${sec} mp`;
    };
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const report = await requestCoachAdvice({
        apiKey: getApiKey()!,
        data: getData(),
        today: todayIso(),
        question,
        signal: controller.signal,
        onProgress: (c) => (chars = c),
      });
      await addCoachReport(report);
      toast('Megérkezett az edző elemzése');
      renderCoachPage(root);
    } catch (err) {
      status!.innerHTML = `<div class="import-box error">${esc((err as Error).message)}</div>`;
      askBtn.textContent = 'Elemzés kérése';
      askBtn.classList.replace('btn-danger', 'btn-primary');
    } finally {
      clearInterval(timer);
      controller = null;
    }
  });

  root.querySelector('#reports')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del]');
    if (!btn) return;
    if (!confirm('Törlöd ezt az elemzést az edzőnaplóból?')) return;
    await deleteCoachReport(btn.dataset.del!);
    renderCoachPage(root);
  });
}
