// immersion.js — 刷剧读书闭环：看前不打扰，看后 10 分钟收尾（复述 / 台词重构 / 五句反应）。
// 铁律：看的过程绝不暂停查词；一集只做 10 分钟后处理——可持续 > 单次强度。
import { el, todayISO, toast } from '../util.js';
import { Store } from '../store.js';
import { llmConfigured } from '../llm.js';
import { addChunk } from '../srs.js';

export async function render(root) {
  const showInput = el('input', { class: 'text-input', placeholder: '剧/集 or 书/章（如 Severance S2E4）' });
  const body = el('div');

  root.append(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', null, '看后收尾')),
    el('p', { class: 'muted sm' }, '正常看完了吗？好——中间没暂停查词吧。下面三选一，10 分钟，做完就停。'),
    showInput,
    el('div', { class: 'slot-grid' },
      modeCard('retell', '复述', '用英文把最精彩的一场戏讲出来，AI 会追问', () => retellMode()),
      modeCard('lines', '台词重构', '挑 3 句印象最深的台词，合上字幕凭记忆说', () => linesMode()),
      modeCard('five', '五句反应', '一个预测、一个吐槽、一个角色评价、一句金句、一个问题', () => fiveMode())),
    body,
  ));

  function modeCard(id, title, desc, fn) {
    return el('div', { class: 'slot-card', tabindex: '0', role: 'button', onclick: fn },
      el('div', { class: 'slot-main' },
        el('div', { class: 'slot-title' }, title),
        el('div', { class: 'slot-desc muted' }, desc)),
      el('span', { class: 'slot-arrow' }, '→'));
  }

  const show = () => showInput.value.trim() || '未注明';

  // ---------- 复述：用户讲，AI 追问 ----------
  async function retellMode() {
    body.textContent = '';
    if (!llmConfigured()) { body.append(noLlm()); return; }
    const ta = el('textarea', { class: 'text-area lang', rows: 5, placeholder: 'Tell me what happened… (英文复述，卡壳的地方最有价值)' });
    const chat = el('div', { class: 'card' });
    const { speakingReply } = await import('../llm.js');
    body.append(ta,
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const text = ta.value.trim();
        if (!text) return;
        ta.value = '';
        chat.append(el('div', { class: 'msg them' }, el('div', { class: 'msg-text lang' }, text)));
        const reply = await speakingReply([{ role: 'user', content: text }],
          `你是用户的朋友，刚一起看完 ${show()}。用户在复述剧情，你听得津津有味并追问（"Wait, why did he do that?"）。一次只追问一个自然的问题。`, []);
        chat.append(el('div', { class: 'msg user' }, el('div', { class: 'msg-text lang' }, reply.ok ? reply.text : '（模型没回应——再讲一段试试）')));
      } }, '讲一段'),
      chat,
      finishRow(5));
  }

  // ---------- 台词重构 ----------
  function linesMode() {
    body.textContent = '';
    const ta = el('textarea', { class: 'text-area lang', rows: 3, placeholder: '贴 3 句原台词（每行一句）——贴完凭记忆说，再对答案' });
    const recall = el('textarea', { class: 'text-area lang', rows: 3, placeholder: '合上上面，凭记忆说出这 3 句…' });
    body.append(ta, recall,
      el('button', { class: 'btn btn-primary', onclick: () => {
        const orig = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
        const said = recall.value.split('\n').map((s) => s.trim()).filter(Boolean);
        const box = el('div', { class: 'card' }, el('div', { class: 'sec-label mono' }, '对照'));
        orig.forEach((o, i) => {
          box.append(el('div', { class: 'compare-row' },
            el('div', { class: 'lang' }, o),
            el('div', { class: 'lang muted' }, said[i] || '（没说出）'),
            el('div', { class: 'mono sm' }, similar(o, said[i] || '') + '%')));
        });
        body.append(box, finishRow(3));
      } }, '对照'),
    );
  }
  function similar(a, b) {
    const norm = (s) => new Set(s.toLowerCase().match(/[a-z']+/g) || []);
    const A = norm(a), B = norm(b);
    if (!A.size || !B.size) return 0;
    let hit = 0; for (const w of A) if (B.has(w)) hit++;
    return Math.round(hit / A.size * 100);
  }

  // ---------- 五句反应 ----------
  function fiveMode() {
    body.textContent = '';
    const PROMPTS = ['一个预测', '一个吐槽', '一个角色评价', '一句金句引用', '一个问题'];
    const tas = PROMPTS.map((p) => el('textarea', { class: 'text-area lang', rows: 2, placeholder: p + '…' }));
    body.append(...tas.map((ta, i) => el('label', { class: 'field' }, el('span', { class: 'field-label mono' }, PROMPTS[i]), ta)),
      finishRow(5));
  }

  function finishRow(maxScore) {
    const score = el('select', { class: 'text-input sm-input' },
      [0, 1, 2, 3, 4, 5].map((n) => el('option', { value: n }, String(n))));
    return el('div', { class: 'card' },
      el('div', { class: 'score-row' },
        el('label', { class: 'score-item' }, el('span', { class: 'field-label mono' }, '自评 0-5'), score),
        el('button', { class: 'btn btn-primary', onclick: async () => {
          await Store.pushLog('immersion', { date: todayISO(), show: show(), score: +score.value });
          toast('已记录——今天到这，别贪');
          location.hash = '#/today';
        } }, '记录 · 到此为止')),
      el('div', { class: 'muted sm', style: 'margin-top:8px' },
        '复述时卡壳的地方比流利的地方更有价值——',
        el('a', { href: '#/harvest', class: 'inline-link' }, '去收割')));
  }

  function noLlm() {
    return el('div', { class: 'notice' },
      '复述追问需要模型（其他两个模式可用）。', el('br'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => location.hash = '#/settings' }, '去配置'));
  }
}
