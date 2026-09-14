// util.js — shared helpers
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const todayISO = (d = new Date()) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
};
export const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const weekStart = (d = new Date()) => {
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  const wd = (t.getDay() + 6) % 7; // Monday = 0
  t.setDate(t.getDate() - wd);
  return t;
};
export const sameWeek = (iso, ref = new Date()) => iso >= todayISO(weekStart(ref)) && iso <= todayISO(ref);
export const daysAgo = (n) => todayISO(new Date(Date.now() - n * 86400000));
export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const pick = (arr, n, rnd = Math.random) => shuffle(arr, rnd).slice(0, n);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- toast ----------
let toastHost = null;
export function toast(msg, kind = 'info', action = null) {
  if (!toastHost) { toastHost = el('div', { class: 'toast-host' }); document.body.append(toastHost); }
  const t = el('div', { class: `toast ${kind}` },
    el('span', { class: 'toast-msg' }, msg),
    action ? el('button', { class: 'toast-btn', onclick: () => { dismiss(); action.onclick(); } }, action.label) : null);
  toastHost.append(t);
  const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 400); };
  setTimeout(() => dismiss(), 3200);
}

// LLM 失败原因 → 中文（http-401 → key 失效 等）
export function reasonCN(r) {
  // 系统词汇红线：不出现 key/限流/服务端这类运维词。用户只需要知道陪练怎么了。
  if (!r) return '出了点状况';
  if (r.startsWith('http-')) {
    const s = r.slice(5);
    return ({ 401: '钥匙过期', 403: '钥匙过期', 429: '陪练太忙' })[s] || `陪练那边出了状况（${s}）`;
  }
  return ({ network: '网络不通', timeout: '没应上话', empty: '没吃声', json: '回话听不懂', noconfig: '还没上场' })[r] || '出了点状况';
}

// ---------- bottom sheet ----------
export function sheet(content, { title = '' } = {}) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    title ? el('div', { class: 'sheet-title' }, title) : null,
    content,
  );
  const close = () => { backdrop.classList.add('closing'); setTimeout(() => backdrop.remove(), 180); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.append(panel);
  document.body.append(backdrop);
  return { close, panel };
}

// ---------- text analysis (泛词密度 / 拐杖词) ----------
export const GENERIC_WORDS = [
  'very', 'really', 'get', 'got', 'getting', 'make', 'made', 'making', 'do', 'did', 'doing',
  'have', 'had', 'having', 'thing', 'things', 'stuff', 'part', 'a lot of', 'lots of',
  'good', 'bad', 'nice', 'big', 'small', 'just', 'so', 'many', 'much',
];
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'as', 'by', 'from', 'not', 'no', 'yes', 'if', 'then', 'than', 'there', 'here', 'what', 'when', 'who', 'how', 'why', 'will', 'would', 'can', 'could', 'should', 'do', 'does', 'did']);
export function analyzeText(text) {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const tokens = (text.toLowerCase().match(/[a-z][a-z'-]*/g)) || [];
  const types = new Set(tokens);
  let genericHits = [];
  for (const g of GENERIC_WORDS) {
    const re = new RegExp(`(?<![a-z])${g.replace(/ /g, '\\s+')}(?![a-z])`, 'g');
    const n = (lower.match(re) || []).length;
    if (n > 0) genericHits.push({ word: g, n });
  }
  genericHits.sort((a, b) => b.n - a.n);
  const genericCount = genericHits.reduce((s, x) => s + x.n, 0);
  const freq = {};
  for (const t of tokens) if (!STOP.has(t)) freq[t] = (freq[t] || 0) + 1;
  const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    tokens: tokens.length,
    ttr: tokens.length ? +(types.size / tokens.length).toFixed(2) : 0,
    genericCount, genericHits, topWords,
    density: tokens.length ? +(genericCount / tokens.length).toFixed(3) : 0,
  };
}

// ---------- voice input ----------
export function createRecognizer({ onInterim, onFinal } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return { supported: false };
  let rec = null;
  return {
    supported: true,
    start(lang = 'en-US') {
      try {
        rec = new SR();
        rec.lang = lang; rec.continuous = true; rec.interimResults = true;
        rec.onresult = (e) => {
          let interim = '', final = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
          }
          if (final && onFinal) onFinal(final.trim());
          if (interim && onInterim) onInterim(interim.trim());
        };
        rec.onerror = () => {};
        rec.start();
      } catch (e) { /* already started etc. */ }
    },
    stop() { try { rec && rec.stop(); } catch (e) {} },
  };
}
