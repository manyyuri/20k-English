// pi.js — pi 模型桥：启动对账 + 探活。配置不由用户管理，桥是事实源。
// 规则（spec T2）：
//   桥可读 & 本地配置命中（baseUrl+model 都在）→ 静默刷新 apiKey（自愈 key 轮换）
//   桥可读 & 失配 → 落到首选供应商首选型号（/flash/i 优先），toast 告知
//   桥可读 & 本地为空 → 首选接入，toast「已接入」
//   桥不可读 & 本地有配置 → 保留（离线训练不破坏），不提示
//   最后后台探活一次（不阻塞首屏），失败 toast + 状态写 settings.llmHealth
import { toast, reasonCN } from './util.js';
import { Store } from './store.js';
import { resetCfgCache, probe, llmConfigured } from './llm.js';

async function fetchBridge() {
  try {
    const r = await fetch('./api/pi-llm');
    if (!r.ok) return null;
    const { providers } = await r.json();
    return Array.isArray(providers) && providers.length ? providers : null;
  } catch (e) { return null; }
}

function pickModel(p) {
  return p.models.find((m) => /flash/i.test(m.id))?.id || p.models[0]?.id || null;
}

export async function reconcilePi({ quiet = false } = {}) {
  const providers = await fetchBridge();
  const s = await Store.getSettings();
  const bridge = providers ? 'ok' : 'unreadable';

  if (providers) {
    const cur = providers.find((p) => p.baseUrl === s.llm.baseUrl && p.models.some((m) => m.id === s.llm.model));
    if (cur) {
      if (s.llm.apiKey !== cur.apiKey) {  // key 轮换自愈，静默
        s.llm.apiKey = cur.apiKey;
        await Store.saveSettings(s); resetCfgCache();
      }
    } else {
      const p = providers[0];
      const model = pickModel(p);
      if (model) {
        const was = llmConfigured(s.llm);
        s.llm = { baseUrl: p.baseUrl, apiKey: p.apiKey, model };
        await Store.saveSettings(s); resetCfgCache();
        if (!quiet) toast(was ? `模型配置已过期 → 已切换 ${p.id}·${model}` : `已接入 pi 的 ${p.id}·${model}`);
      }
    }
  }
  // 桥不可读：保留本地配置，只在设置里记状态

  if (s.piBridge !== bridge) { s.piBridge = bridge; await Store.saveSettings(s); }
  if (s.llm.baseUrl) probeAndRecord({ quiet }).catch(() => {});  // 后台探活，不 await 不拦首屏
  return { bridge };
}

export async function probeAndRecord({ quiet = false } = {}) {
  const h = await probe();
  const s = await Store.getSettings();
  s.llmHealth = { ok: h.ok, ms: h.ms ?? null, reason: h.reason || null, at: new Date().toISOString() };
  await Store.saveSettings(s);
  if (!h.ok && !quiet) {
    toast(`模型探活失败（${reasonCN(h.reason)}）`, 'warn', failAction(h.reason));
  }
  return h;
}

// 失败原因 → toast 动作：鉴权类给「重连桥」（reconcile 会刷 key / 切供应商），其他场景由调用方给 retry
export function failAction(reason, retry) {
  if (/^http-(401|403)$/.test(reason)) return { label: '重连桥', onclick: () => reconcilePi() };
  return retry ? { label: '重试', onclick: retry } : null;
}
