// store.js — IndexedDB-first kv store（localStorage 兜底）。bank.json 是唯一事实源格式。
const DB_NAME = 'en20k';
const STORE = 'kv';
let dbp = null;
const mem = {}; // in-memory cache

function openDB() {
  if (dbp === null) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  return dbp;
}
async function idbGet(k) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function idbSet(k, v) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(v, k);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
async function lsGet(k) { try { const v = localStorage.getItem('en20k:' + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }
async function lsSet(k, v) { try { localStorage.setItem('en20k:' + k, JSON.stringify(v)); } catch (e) {} }

async function get(k, fallback) {
  if (k in mem) return mem[k];
  let v = await idbGet(k);
  if (v == null) v = await lsGet(k);
  if (v == null) v = fallback;
  mem[k] = v;
  return v;
}
async function set(k, v) {
  mem[k] = v;
  const ok = await idbSet(k, v);
  if (!ok) await lsSet(k, v);
}

const emptyLogs = () => ({ drill: [], speaking: [], paraphrase: [], upgrade: [], immersion: [], audit: [] });
const defaultSettings = () => ({ llm: { baseUrl: '', apiKey: '', model: '' }, voiceLang: 'en-US' });

export const Store = {
  async getBank() { return (await get('bank', null)) || { chunks: [] }; },
  async saveBank(bank) { await set('bank', bank); },
  async getLogs() { const l = await get('logs', null); return l ? { ...emptyLogs(), ...l } : emptyLogs(); },
  async pushLog(type, entry) {
    const logs = await this.getLogs();
    logs[type] = logs[type] || [];
    logs[type].push(entry);
    await set('logs', logs);
  },
  async getProfile() { return await get('profile', null); },
  async saveProfile(p) { await set('profile', p); },
  async getAuditState() { return await get('auditState', null); },
  async saveAuditState(s) { await set('auditState', s); },
  async getSettings() { return { ...defaultSettings(), ...((await get('settings', null)) || {}) }; },
  async saveSettings(s) { await set('settings', s); },
  async getRotation() { return (await get('rotation', null)) || { scenarioIdx: 0, lastScenario: '', sameCount: 0 }; },
  async saveRotation(r) { await set('rotation', r); },

  async exportAll() {
    return JSON.stringify({
      app: 'en20k', version: 1, exported: new Date().toISOString(),
      bank: await this.getBank(), logs: await this.getLogs(),
      profile: await this.getProfile(), settings: { ...(await this.getSettings()), llm: { ...(await this.getSettings()).llm, apiKey: '' } },
    }, null, 2);
  },

  // 导入 bank.json（与 agent skill 的 srs.py 双向兼容）
  async importBankText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: '不是合法 JSON' }; }
    const chunks = Array.isArray(data) ? data : data.chunks;
    if (!Array.isArray(chunks)) return { ok: false, error: '缺少 chunks 数组' };
    const bank = await this.getBank();
    const norm = (s) => String(s || '').trim().toLowerCase();
    const index = new Map(bank.chunks.map((c) => [norm(c.chunk), c]));
    const usedIds = new Set(bank.chunks.map((c) => c.id));
    let nextNum = bank.chunks.reduce((m, c) => { const g = /^c-(\d+)$/.exec(c.id || ''); return g ? Math.max(m, +g[1]) : m; }, 0);
    let added = 0, merged = 0;
    for (const inc of chunks) {
      if (!inc || !inc.chunk) continue;
      const exist = index.get(norm(inc.chunk));
      if (exist) {
        // 已存在：保留本地 srs/status，补齐缺失字段
        for (const f of ['gloss', 'register', 'source', 'my_example']) {
          if (!exist[f] && inc[f]) { exist[f] = inc[f]; merged++; }
        }
        if ((!exist.examples || !exist.examples.length) && Array.isArray(inc.examples)) { exist.examples = inc.examples; merged++; }
      } else {
        const entry = addImported(inc, usedIds, () => 'c-' + String(++nextNum).padStart(4, '0'));
        bank.chunks.push(entry);
        index.set(norm(entry.chunk), entry);
        added++;
      }
    }
    await this.saveBank(bank);
    return { ok: true, added, merged, total: bank.chunks.length };
  },

  async clearAll() {
    for (const k of Object.keys(mem)) delete mem[k];
    try { localStorage.clear(); } catch (e) {}
    const db = await openDB();
    if (db) {
      await new Promise((res) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => res(); tx.onerror = () => res();
        } catch (e) { res(); }
      });
    }
  },
};

function addImported(inc, usedIds = new Set(), newId) {
  const today = new Date().toISOString().slice(0, 10);
  let id = inc.id || '';
  if (!id || usedIds.has(id)) id = newId();
  usedIds.add(id);
  return {
    id,
    type: inc.type || 'collocation',
    chunk: inc.chunk,
    gloss: inc.gloss || '',
    register: inc.register || '',
    source: inc.source || '',
    examples: Array.isArray(inc.examples) ? inc.examples : [],
    my_example: inc.my_example || '',
    status: inc.status === 'active' ? 'active' : 'learning',
    tags: Array.isArray(inc.tags) ? inc.tags : [],
    created: inc.created || today,
    srs: inc.srs && typeof inc.srs === 'object' ? inc.srs : { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0, streak: 0 },
  };
}
