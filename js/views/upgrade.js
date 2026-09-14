// upgrade.js — 表达升级审稿：语域 → 泛词/拐杖词 → 中式表达。泛词密度是核心指标。
import { el, todayISO, toast, analyzeText, sheet, reasonCN } from '../util.js';
import { Store } from '../store.js';
import { addChunk } from '../srs.js';
import { llmConfigured, upgradeReview } from '../llm.js';

const PURPOSES = ['给老板/客户的邮件', 'PR 描述', '技术文档/博客', '周报/汇报', '剧评/书评', '聊天记录（口语）'];

export async function render(root) {
  const purpose = el('select', { class: 'text-input' }, PURPOSES.map((p) => el('option', { value: p }, p)));
  const textBox = el('textarea', { class: 'text-area lang', rows: 10, placeholder: '贴一段你自己写的英文（≥100 词）——要给人看的那种，笔记不值得审…' });
  const liveDensity = el('div', { class: 'mono sm muted' });
  const result = el('div');

  function refresh() {
    const a = analyzeText(textBox.value);
    liveDensity.textContent = a.tokens >= 20
      ? `${a.tokens} 词 · 泛词密度 ${a.density.toFixed(3)} · very/really ×${a.genericHits.filter((g) => ['very', 'really'].includes(g.word)).reduce((s, g) => s + g.n, 0)}`
      : '';
  }
  textBox.addEventListener('input', refresh);

  root.append(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', null, '表达升级')),
    el('p', { class: 'muted sm' }, '三层审稿：先判语域是否匹配用途，再逐处升级泛词与拐杖词，最后识别中式表达并解释为什么。'),
    purpose, textBox, liveDensity,
    el('button', { class: 'btn btn-primary', onclick: doReview }, '三层审稿 →'),
    result,
  ));

  async function doReview() {
    const text = textBox.value.trim();
    if (text.split(/\s+/).length < 30) { toast('太短了——至少 30 词，最好 100+', 'warn'); return; }
    result.textContent = '';
    result.append(el('div', { class: 'mono muted skeleton-inline' }, '审稿中…'));
    const local = analyzeText(text);
    const rr = llmConfigured() ? await upgradeReview({ text, purpose: purpose.value }) : null;
    const r = rr && rr.ok ? rr.data : null;
    result.textContent = '';

    if (!r) {
      result.append(el('div', { class: 'notice' }, rr ? `陪练离场（${reasonCN(rr.reason)}）——本地泛词扫描仍有效（见上方密度）。` : '陪练没上场——本地泛词扫描仍有效（见上方密度）。'));
    } else {
      if (Array.isArray(r.registerIssues) && r.registerIssues.length) {
        result.append(el('div', { class: 'card alarm-card' },
          el('div', { class: 'sec-label mono alarm-text' }, '语域错配（先改这个）'),
          r.registerIssues.map((i) => el('div', { class: 'sm' }, '· ' + i))));
      }
      const table = Array.isArray(r.table) ? r.table : [];
      if (table.length) {
        const selected = new Set();
        const t = el('div', { class: 'card' },
          el('div', { class: 'sec-label mono' }, `升级表（勾选 3-5 个入库）`),
          el('div', { class: 'upgrade-rows' }, table.map((row, i) =>
            el('label', { class: 'upgrade-row' },
              el('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? selected.add(i) : selected.delete(i); } }),
              el('div', { class: 'upgrade-cells' },
                el('div', { class: 'lang' }, row.orig || ''),
                el('div', { class: 'lang arrow-cell' }, '→'),
                el('div', { class: 'lang upgrade-better' }, row.better || ''),
                el('div', { class: 'muted sm' }, row.why || ''))))));
        result.append(t);
        if (r.rewrite) {
          result.append(el('div', { class: 'card' },
            el('div', { class: 'sec-label mono' }, '整体升级版（保持你的结构）'),
            el('div', { class: 'lang rewrite-box' }, r.rewrite)));
        }
        if (Array.isArray(r.patterns) && r.patterns.length) {
          result.append(el('div', { class: 'card' },
            el('div', { class: 'sec-label mono' }, '可复用模式'),
            r.patterns.map((p) => el('div', { class: 'sm' }, '· ' + p))));
        }
        result.append(el('button', { class: 'btn btn-primary', onclick: () => {
          const picks = [...selected].map((i) => table[i]).filter(Boolean);
          if (!picks.length) { toast('先勾选要入库的升级对', 'warn'); return; }
          bankThem(picks);
        } }, '把勾选的招进班底 →'));
      }
    }
    // 记录（泛词密度 = 本系统核心指标）
    result.append(el('button', { class: 'btn btn-ghost', onclick: async () => {
      await Store.pushLog('upgrade', {
        date: todayISO(), textType: purpose.value, words: local.tokens,
        density: local.density, newCrutches: local.genericHits.slice(0, 5).map((g) => g.word),
      });
      toast('已记录 — 目标 6 个月内泛词密度降到基线一半以下');
      location.hash = '#/today';
    } }, '记录本场（密度 ' + local.density.toFixed(3) + '）'));
  }

  async function bankThem(picks) {
    const bank = await Store.getBank();
    for (const p of picks) {
      const my = el('textarea', { class: 'answer-input lang', rows: 2, placeholder: `用「${p.better}」当场造一句` });
      await new Promise((resolve) => {
        const sh = sheet(el('div', null,
          el('div', { class: 'detail-chunk lang' }, p.better || ''),
          el('div', { class: 'muted sm' }, '入库门票：当场造一句你自己的话'),
          my,
          el('div', { class: 'input-row' },
            el('button', { class: 'btn btn-primary', onclick: () => {
              const v = my.value.trim();
              if (!v) { toast('先造一句', 'warn'); return; }
              addChunk(bank, {
                chunk: p.better, gloss: p.why || '', type: 'collocation',
                register: '来自 upgrade', source: 'upgrade · ' + purpose.value,
                examples: p.orig ? [p.orig] : [], my_example: v,
              });
              sh.close(); resolve();
            } }, '入库'),
            el('button', { class: 'btn-text', onclick: () => { sh.close(); resolve(); } }, '跳过'))));
      });
    }
    await Store.saveBank(bank);
    toast(`已入库 ${picks.length} 条`);
  }
}
