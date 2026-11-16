import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { getData, init } from './state';
import { requestPersistence } from './storage/db';
import { renderCoachPage } from './ui/coachPage';
import { renderHome } from './ui/home';
import { renderPrepPage } from './ui/prepPage';
import { renderLog } from './ui/log';
import { renderNewSession } from './ui/newSession';
import { renderSettings } from './ui/settings';
import { applyTheme } from './ui/shell';

const routes: Record<string, (root: HTMLElement, params: URLSearchParams) => void> = {
  '': renderHome,
  uj: renderNewSession,
  naplo: renderLog,
  beallitasok: renderSettings,
  edzo: renderCoachPage,
  'verseny-elott': renderPrepPage,
};

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const render = routes[path] ?? renderHome;
  const root = document.getElementById('view')!;
  root.scrollTop = 0;
  window.scrollTo(0, 0);
  render(root, new URLSearchParams(query));
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => {
    const target = a.getAttribute('href')!.replace(/^#\/?/, '');
    const active = target === (routes[path] ? path : '');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function start() {
  await init();
  applyTheme(getData().settings.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getData().settings.theme));
  window.addEventListener('hashchange', route);
  route();
  requestPersistence();
  registerSW({ immediate: true });
}

start();
