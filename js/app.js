// app.js — shell + hash router
import { el, clear } from './util.js';
import { reconcilePi } from './pi.js';

const VIEWS = {};
async function loadViews() {
  Object.assign(VIEWS, {
    today: (await import('./views/today.js')).render,
    drill: (await import('./views/drill.js')).render,
    bank: (await import('./views/bank.js')).render,
    harvest: (await import('./views/harvest.js')).render,
    review: (await import('./views/review.js')).render,
    audit: (await import('./views/audit.js')).render,
    speaking: (await import('./views/speaking.js')).render,
    paraphrase: (await import('./views/paraphrase.js')).render,
    upgrade: (await import('./views/upgrade.js')).render,
    immersion: (await import('./views/immersion.js')).render,
    settings: (await import('./views/settings.js')).render,
  });
}

const STAGE_ROUTES = new Set(['drill', 'speaking', 'immersion']); // 训练舞台：导航消失
let cleanup = null;

function parseHash() {
  const h = (location.hash || '#/today').replace(/^#\/?/, '');
  const [name, qstr] = h.split('?');
  const params = new URLSearchParams(qstr || '');
  return { name: VIEWS[name] ? name : 'today', params };
}

async function render() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }  const { name, params } = parseHash();
  const main = document.getElementById('main');
  clear(main);
  document.body.classList.toggle('stage', STAGE_ROUTES.has(name));
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === '#/' + name);
  });
  if (VIEWS[name]) {
    cleanup = (await VIEWS[name](main, params)) || null;
  }
  main.scrollTop = 0;
}

async function boot() {
  await loadViews();
  await reconcilePi();  // 每次启动对账：key 轮换自愈、失配自动切换、后台探活
  const gear = document.querySelector('#gear');
  gear.addEventListener('click', () => { location.hash = '#/settings'; });
  window.addEventListener('hashchange', render);
  await render();
  // service worker
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) {}
  }
}

boot();
