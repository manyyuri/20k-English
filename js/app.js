// app.js — shell + hash router
import { el, clear } from './util.js';
import { reconcilePi } from './pi.js';
import { checkInbox } from './inbox.js';
import { Store } from './store.js';

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
  document.querySelectorAll('.tabbar a, .rail-nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === '#/' + name);
  });
  drawRailHealth();
  if (VIEWS[name]) {
    cleanup = (await VIEWS[name](main, params)) || null;
  }
  main.scrollTop = 0;
  scrollTo(0, 0);
}

// 场记栏陪练状态灯：绿 = 在场，红 = 离场
async function drawRailHealth() {
  const dot = document.getElementById('rail-dot');
  if (!dot) return;
  try {
    const s = await Store.getSettings();
    const ok = s.piBridge === 'ok' && (!s.llmHealth || s.llmHealth.ok);
    dot.classList.toggle('ok', ok);
    dot.classList.toggle('bad', !ok);
    dot.title = ok ? '陪练在场' : '陪练离场';
  } catch (e) {}
}

// 全局快捷键：1/2/3 切三主页面（输入时、舞台模式不生效）
function bindGlobalKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.body.classList.contains('stage')) return;
    const map = { '1': '#/today', '2': '#/bank', '3': '#/review' };
    if (map[e.key]) { location.hash = map[e.key]; }
  });
}

async function boot() {
  await loadViews();
  await reconcilePi();  // 每次启动对账：key 轮换自愈、失配自动切换、后台探活
  const toSettings = () => { location.hash = '#/settings'; };
  document.querySelectorAll('#gear, #rail-gear').forEach((g) => g.addEventListener('click', toSettings));
  window.addEventListener('hashchange', render);
  bindGlobalKeys();
  await render();
  checkInbox();  // 收割收件箱：agent 在终端收的语块，app 打开时一键入库
  // service worker
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) {}
  }
}

boot();
