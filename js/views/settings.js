// settings.js — 模型=运行时状态（探活心跳 + 切换型号），数据（bank.json 双向），清空。
// 手动配置已移除：桥（~/.pi/agent/models.json 经 server.mjs）是唯一配置来源。
import { el, toast, download, reasonCN } from '../util.js';
import { Store } from '../store.js';
import { resetCfgCache, probe } from '../llm.js';
import { reconcilePi } from '../pi.js';

export async function render(root) {
  const s = await Store.getSettings();

  // ---------- 模型：状态 + 诊断 + 折叠切换 ----------
  const healthLine = el('div', { class: 'health-line mono sm' });
  const healthDot = el('span', { class: 'health-dot' });
  const probeBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => {
    const btn = e.currentTarget; btn.textContent = '点名中…';
    const h = await probe();
    btn.textContent = '重试';
    const st = await Store.getSettings();
    st.llmHealth = { ok: h.ok, ms: h.ms ?? null, reason: h.reason || null, at: new Date().toISOString() };
    await Store.saveSettings(st);
    drawHealth(st);
    if (!h.ok) toast(`陪练离场（${reasonCN(h.reason)}）`, 'warn', { label: '重连', onclick: () => reconcilePi() });
  } }, '重试');

  function relTime(at) {
    if (!at) return '从未';
    const sec = Math.round((Date.now() - new Date(at).getTime()) / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
    if (sec < 86400) return `${Math.round(sec / 3600)} 小时前`;
    return `${Math.round(sec / 86400)} 天前`;
  }
  function drawHealth(st) {
    const h = st.llmHealth;
    healthDot.className = 'health-dot' + (h ? (h.ok ? ' ok' : ' bad') : '');
    healthLine.textContent = '';
    if (!st.llm.baseUrl) {
      healthLine.append('还没上场');
      return;
    }
    const host = (() => { try { return new URL(st.llm.baseUrl).host; } catch { return st.llm.baseUrl; } })();
    healthLine.append(
      h ? (h.ok ? `在线 · ${h.ms}ms` : `离场（${reasonCN(h.reason)}）`) : '未上场',
      ` · ${st.llm.model} @ ${host} · ${relTime(h?.at)}点名`);
  }
  drawHealth(s);

  const modelCard = el('div', { class: 'card' },
    el('div', { class: 'sec-label mono' }, '陪练'),
    el('p', { class: 'muted sm' }, '陪练从本机 pi 的 models.json 里来。排期全部本地计算，钥匙只存本地。'),
    el('div', { class: 'health-row' }, healthDot, healthLine),
    el('div', { class: 'btn-row' }, probeBtn),
    el('div', { class: 'switcher' }),
  );
  const switcher = modelCard.querySelector('.switcher');

  fetch('./api/pi-llm').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const providers = (d && d.providers) || [];
    if (!providers.length) {
      switcher.append(el('div', { class: 'notice' },
        el('span', null, '陪练还没上场——需要用 node server.mjs 启动（他去 ~/.pi/agent/models.json 报到）。'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          await reconcilePi();
          const st = await Store.getSettings(); drawHealth(st);
          toast(st.piBridge === 'ok' ? '陪练已上场' : '陪练还没来', st.piBridge === 'ok' ? 'ok' : 'warn');
        } }, '重试')));
      return;
    }
    const n = providers.reduce((m, p) => m + p.models.length, 0);
    const det = el('details', { class: 'model-switch' },
      el('summary', null, `换一位陪练（${n} 位可选）`),
      el('div', { class: 'pi-pickers' }, providers.map((p) => [
        el('div', { class: 'sec-label mono' }, p.id),
        el('div', { class: 'chip-row' }, p.models.map((m) =>
          el('button', {
            class: 'chip' + (s.llm.baseUrl === p.baseUrl && s.llm.model === m.id ? ' on' : ''),
            title: p.baseUrl,
            onclick: async (e) => {
              s.llm = { baseUrl: p.baseUrl, apiKey: p.apiKey, model: m.id };
              await Store.saveSettings(s); resetCfgCache();
              det.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
              e.currentTarget.classList.add('on');
              drawHealth({ ...s, llmHealth: null });
              toast(`已换：${p.id} · ${m.id}`);
              probeBtn.click();  // 换完即点名，状态行马上有真相
            },
          }, m.id))),
      ])));
    switcher.append(det);
  }).catch(() => switcher.append(el('div', { class: 'muted sm' }, '陪练没上场（静态部署）——用 node server.mjs 启动即可。')));

  root.append(el('div', { class: 'page settings-page' },
    el('div', { class: 'page-head' }, el('h1', null, '设置')),
    modelCard,

    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '数据'),
      el('p', { class: 'muted sm' }, 'bank.json 是唯一事实源格式，与 agent skill（skills/english-active-20k/）双向兼容：导出的文件可以直接跑 en20k-drill 的 srs.py。'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          const bank = await Store.getBank();
          download('bank.json', JSON.stringify(bank, null, 2) + '\n');
        } }, '导出 bank.json'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          const inp = el('input', { type: 'file', accept: '.json,application/json' });
          inp.addEventListener('change', async () => {
            const f = inp.files[0]; if (!f) return;
            const text = await f.text();
            const r = await Store.importBankText(text);
            if (!r.ok) { toast('导入失败：' + r.error, 'warn'); return; }
            toast(`导入完成：新增 ${r.added}，合并 ${r.merged}，共 ${r.total}`);
            location.hash = '#/bank';
          });
          inp.click();
        } }, '导入 bank.json（合并）'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          download('en20k-backup.json', await Store.exportAll());
        } }, '导出全部备份'),
      ),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '危险区'),
      el('button', { class: 'btn btn-ghost btn-sm danger', onclick: async () => {
        if (!confirm('清空所有本地数据（班底、日志、画像、设置）？不可恢复。')) return;
        if (!confirm('真的确定？先导出备份吧。')) return;
        await Store.clearAll(); resetCfgCache();
        toast('已清空');
        location.hash = '#/today';
      } }, '清空全部数据'),
    ),

    el('div', { class: 'card about' },
      el('div', { class: 'sec-label mono' }, '关于'),
      el('div', { class: 'sm' }, 'en20k — 产出式词汇激活训练器。反识别、反囤积、到点就停。'),
      el('div', { class: 'muted sm', style: 'margin-top:6px' },
        '设计文档见仓库 DESIGN.md；训练逻辑源自 skills/english-active-20k 的 8 个 skill。')),
  ));
}
