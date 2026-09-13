// settings.js — LLM 端点（自带 key）、数据（bank.json 双向）、清空。
import { el, toast, download } from '../util.js';
import { Store } from '../store.js';
import { testConnection, resetCfgCache } from '../llm.js';

export async function render(root) {
  const s = await Store.getSettings();
  const baseUrl = el('input', { class: 'text-input', type: 'url', value: s.llm.baseUrl || '', placeholder: 'https://api.openai.com/v1 或 http://localhost:11434/v1' });
  const apiKey = el('input', { class: 'text-input', type: 'password', value: s.llm.apiKey || '', placeholder: 'API key（本地存储，可选）' });
  const model = el('input', { class: 'text-input', value: s.llm.model || '', placeholder: 'gpt-4o-mini / qwen2.5:14b / …' });

  const piBox = el('div', { class: 'btn-row' });
  fetch('./api/pi-llm').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.providers || !d.providers.length) {
      piBox.append(el('span', { class: 'muted sm' }, '未检测到（静态部署或无 openai-completions 供应商）— 手动填即可'));
      return;
    }
    for (const p of d.providers) {
      for (const m of p.models) {
        piBox.append(el('button', { class: 'chip', title: p.baseUrl, onclick: () => {
          baseUrl.value = p.baseUrl; apiKey.value = p.apiKey; model.value = m.id;
        } }, `${p.id} · ${m.id}`));
      }
    }
  }).catch(() => piBox.append(el('span', { class: 'muted sm' }, '未检测到')));

  root.append(el('div', { class: 'page settings-page' },
    el('div', { class: 'page-head' }, el('h1', null, '设置')),

    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '模型（OpenAI 兼容）'),
      el('p', { class: 'muted sm' }, '排期全部本地计算；模型只负责语言判断（出题、评分、陪练、审稿）。key 只存在本地。'),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Base URL'), baseUrl),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'API Key'), apiKey),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Model'), model),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: async (e) => {
          s.llm = { baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() };
          await Store.saveSettings(s); resetCfgCache();
          const btn = e.currentTarget; btn.textContent = '测试中…';
          const ok = await testConnection();
          btn.textContent = '保存并测试';
          toast(ok ? '模型连接正常' : '连不上——检查 URL / key / model', ok ? 'ok' : 'warn');
        } }, '保存并测试')),
    ),

    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, 'pi 桥（本机 models.json）'),
      el('p', { class: 'muted sm' }, '用 node server.mjs 启动时可直接读 pi 的供应商，点一下填入上方表单：'),
      piBox),

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
