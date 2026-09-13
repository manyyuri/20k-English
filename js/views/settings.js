// settings.js — 模型从 pi 桥一键切换（无手动表单）、数据（bank.json 双向）、清空。
import { el, toast, download } from '../util.js';
import { Store } from '../store.js';
import { testConnection, resetCfgCache } from '../llm.js';

export async function render(root) {
  const s = await Store.getSettings();

  // ---------- 模型：pi 桥驱动，点一下即存 ----------
  const statusLine = el('div', { class: 'mono sm' });
  const testBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: async (e) => {
    if (!s.llm.baseUrl) { toast('先选一个模型', 'warn'); return; }
    const btn = e.currentTarget; btn.textContent = '测试中…';
    const ok = await testConnection();
    btn.textContent = '测试连接';
    toast(ok ? '连接正常' : '连不上——看终端日志或换个型号', ok ? 'ok' : 'warn');
  } }, '测试连接');

  function refreshStatus() {
    statusLine.textContent = s.llm.baseUrl
      ? `当前：${s.llm.model} @ ${host(s.llm.baseUrl)}`
      : '未配置（收割/评分/陪练不可用，drill 自评模式照常）';
  }
  function host(u) { try { return new URL(u).host; } catch { return u; } }
  refreshStatus();

  const piBox = el('div', { class: 'pi-pickers' }, el('div', { class: 'mono sm skeleton-inline' }, '读取 pi 配置…'));
  fetch('./api/pi-llm').then((r) => (r.ok ? r.json() : null)).then((d) => {
    piBox.textContent = '';
    const providers = (d && d.providers) || [];
    if (!providers.length) {
      piBox.append(el('div', { class: 'notice' },
        el('span', null, '没读到 pi 配置——需要用 node server.mjs 启动（读取 ~/.pi/agent/models.json）。')));
      return;
    }
    for (const p of providers) {
      piBox.append(el('div', { class: 'sec-label mono' }, p.id));
      piBox.append(el('div', { class: 'chip-row' }, p.models.map((m) =>
        el('button', {
          class: 'chip' + (s.llm.baseUrl === p.baseUrl && s.llm.model === m.id ? ' on' : ''),
          title: p.baseUrl,
          onclick: async (e) => {
            s.llm = { baseUrl: p.baseUrl, apiKey: p.apiKey, model: m.id };
            await Store.saveSettings(s); resetCfgCache();
            piBox.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
            e.currentTarget.classList.add('on');
            refreshStatus();
            toast(`已切换：${p.id} · ${m.id}`);
          },
        }, m.id))));
    }
  }).catch(() => {
    piBox.textContent = '';
    piBox.append(el('div', { class: 'notice' }, el('span', null, 'pi 桥不可用（静态部署）——用 node server.mjs 启动即可。')));
  });

  root.append(el('div', { class: 'page settings-page' },
    el('div', { class: 'page-head' }, el('h1', null, '设置')),

    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '模型'),
      el('p', { class: 'muted sm' }, '来自本机 pi 的 models.json，点一下即切换。排期仍全部本地计算，key 只存本地。'),
      statusLine,
      piBox,
      el('div', { class: 'btn-row' }, testBtn),
    ),

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
        if (!confirm('清空所有本地数据（语块库、日志、画像、设置）？不可恢复。')) return;
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
