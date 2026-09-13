// harvest.js — 语块收割：材料 → 候选 → 「认识但用不出？」确认 → 当场造 my_example → 入库。
// 纪律：不收已会的；每次 8-12 条；每周新增 ≤60，超了警告——激活比囤积重要。
import { el, clear, sheet, todayISO, weekStart, toast } from '../util.js';
import { Store } from '../store.js';
import { addChunk } from '../srs.js';
import { llmConfigured, harvestCandidates, checkMyExample } from '../llm.js';
import { reasonCN } from '../util.js';
import { failAction } from '../pi.js';

const TYPES = [['collocation', '搭配'], ['phrasal', '短语动词'], ['idiom', '习语'], ['frame', '句式'], ['single', '精确词']];

export async function render(root, params) {
  const bank = await Store.getBank();
  const manual = params.get('mode') === 'manual';

  const page = el('div', { class: 'page harvest-page' });
  root.append(page);

  if (manual) { renderManual(page); return; }

  const srcInput = el('input', { class: 'text-input', placeholder: '出处（如 Silicon Valley S2E3 / 三体 第 5 章 / 某邮件）' });
  const textBox = el('textarea', { class: 'text-area lang', rows: 8, placeholder: '贴一段材料：台词、字幕、小说段落、技术文章、播客文稿…' });
  const resultBox = el('div', { class: 'harvest-result' });
  const weekCount = el('div', { class: 'mono sm muted' });

  function refreshWeek() {
    const start = todayISO(weekStart());
    const n = bank.chunks.filter((c) => (c.created || '') >= start).length;
    weekCount.textContent = `本周已收 ${n} / 60`;
    weekCount.classList.toggle('alarm-text', n > 60);
  }
  refreshWeek();

  page.append(
    el('div', { class: 'page-head' }, el('h1', null, '收割')),
    el('p', { class: 'muted sm' }, '只收「认识但用不出」的语块——母语者的流利来自成千上万个预制语块，不是单词表。'),
    srcInput, textBox,
    el('div', { class: 'input-row' },
      el('button', { class: 'btn btn-primary', onclick: doHarvest }, llmConfigured() ? '标记候选 →' : '标记候选（未配模型，将失败）→'),
      el('button', { class: 'btn btn-ghost', onclick: () => renderManual(page) }, '手动入库')),
    weekCount, resultBox,
  );

  async function doHarvest() {
    const text = textBox.value.trim();
    if (text.length < 40) { toast('材料太短了，至少贴一段完整的话', 'warn'); return; }
    clear(resultBox);
    resultBox.append(el('div', { class: 'mono muted skeleton-inline' }, '标记中…'));
    const r = await harvestCandidates(text, srcInput.value.trim());
    clear(resultBox);
    if (!r.ok) {
      toast(`模型没接上（${reasonCN(r.reason)}）`, 'warn', failAction(r.reason, doHarvest));
      resultBox.append(el('div', { class: 'notice' }, `模型没接上（${reasonCN(r.reason)}）——或用手动入库。`));
      return;
    }
    const list = (Array.isArray(r.data.candidates) ? r.data.candidates : []).slice(0, 12);
    if (!list.length) {
      resultBox.append(el('div', { class: 'notice' }, '模型没有返回候选——换个段落再试，或用手动入库。'));
      return;
    }
    resultBox.append(el('div', { class: 'sec-label mono' }, `${list.length} 个候选 · 逐个确认`));
    for (const cand of list) resultBox.append(candidateCard(cand, srcInput.value.trim()));
  }

  function candidateCard(cand, source) {
    const card = el('div', { class: 'cand-card' },
      el('div', { class: 'cand-head' },
        el('span', { class: 'chunk lang' }, cand.chunk || ''),
        el('span', { class: 'type-tag mono' }, cand.type || '')),
      el('div', { class: 'muted sm' }, cand.gloss || ''),
      cand.register ? el('div', { class: 'sm muted' }, '语域：', cand.register) : null,
      cand.example ? el('div', { class: 'ex lang' }, cand.example) : null,
      el('div', { class: 'cand-actions' },
        el('button', { class: 'btn btn-sm', onclick: () => confirmAdd(card, cand, source) }, '认识但用不出 · 收'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => card.remove() }, '已会用 / 跳过')),
    );
    return card;
  }

  function confirmAdd(card, cand, source) {
    const input = el('textarea', { class: 'answer-input lang', rows: 2, placeholder: '用「' + (cand.chunk || '') + '」当场造一句你自己的话（工作 / 生活 / 聊剧）' });
    const warn = el('div', { class: 'sm alarm-text' });
    const sh = sheet(el('div', { class: 'confirm-add' },
      el('div', { class: 'detail-chunk lang' }, cand.chunk || ''),
      el('div', { class: 'muted sm' }, cand.gloss || ''),
      el('div', { class: 'sec-label mono', style: 'margin-top:12px' }, '你的例句（必填）'),
      input, warn,
      el('div', { class: 'input-row' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          const v = input.value.trim();
          if (!v) { toast('先造一句——这是入库的门票', 'warn'); return; }
          if (llmConfigured()) {
            warn.textContent = '检查中…';
            const r = await checkMyExample({ chunk: cand.chunk, gloss: cand.gloss, register: cand.register }, v);
            warn.textContent = '';
            const chk = r.ok ? r.data : null;
            if (chk && chk.ok === false && Array.isArray(chk.issues) && chk.issues.length) {
              warn.append('句子有问题：', ...r.issues.map((i) => el('div', null, '· ' + i)), el('div', { class: 'muted' }, '改一下重造，再入库。'));
              return;
            }
          }
          addChunk(bank, {
            chunk: cand.chunk, gloss: cand.gloss, type: cand.type,
            register: cand.register, source: source || cand.source || '',
            examples: cand.example ? [cand.example] : [], my_example: v,
          });
          await Store.saveBank(bank);
          refreshWeek();
          sh.close(); card.remove();
          toast(`已入库：${cand.chunk}`);
        } }, '检查并入库'),
      ),
    ));
  }

  // ---------- 手动模式 ----------
  function renderManual(container) {
    clear(container);
    const fields = {};
    const f = (key, label, node) => { fields[key] = node; return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), node); };
    container.append(
      el('div', { class: 'page-head' }, el('h1', null, '手动入库')),
      el('div', { class: 'form-col' },
        f('chunk', '语块 *', el('input', { class: 'text-input lang', placeholder: 'push back on' })),
        f('gloss', '释义 *', el('input', { class: 'text-input', placeholder: '对…提出异议' })),
        f('type', '类型', typeSelect()),
        f('register', '语域', el('input', { class: 'text-input', placeholder: 'neutral; 职场高频' })),
        f('source', '出处', el('input', { class: 'text-input', placeholder: 'Silicon Valley S2' })),
        f('example', '例句（一行一句）', el('textarea', { class: 'text-area lang', rows: 3, placeholder: "We pushed back on the timeline.\nDon't be afraid to push back on scope creep." })),
        f('my_example', '我的例句 *（当场造）', el('textarea', { class: 'text-area lang', rows: 2, placeholder: "I'd push back on that design — it couples the services too tightly." })),
        f('tags', '标签（逗号分隔）', el('input', { class: 'text-input', placeholder: 'work,tech' })),
        el('button', { class: 'btn btn-primary', onclick: async () => {
          const chunk = fields.chunk.value.trim();
          const my = fields.my_example.value.trim();
          if (!chunk || !my) { toast('语块和「我的例句」必填', 'warn'); return; }
          const examples = fields.example.value.split('\n').map((s) => s.trim()).filter(Boolean);
          addChunk(bank, {
            chunk, gloss: fields.gloss.value.trim(), type: fields.type.value,
            register: fields.register.value.trim(), source: fields.source.value.trim(),
            examples, my_example: my,
            tags: fields.tags.value.split(',').map((s) => s.trim()).filter(Boolean),
          });
          await Store.saveBank(bank);
          toast(`已入库：${chunk}`);
          history.back();
        } }, '入库'),
      ));
  }
  function typeSelect() {
    const sel = el('select', { class: 'text-input' }, TYPES.map(([v, label]) => el('option', { value: v }, `${label} ${v}`)));
    return sel;
  }
}
