// paraphrase.js — 一句三说：casual / neutral / precise。先说完三版再点评；沉默词唤醒是激活最快的一刀。
import { el, todayISO, toast, reasonCN } from '../util.js';
import { Store } from '../store.js';
import { llmConfigured, paraphraseReview } from '../llm.js';

const PROMPTS = [
  '这个 deadline 根本来不及，我们得砍需求。',
  '这个 bug 不是我写的代码造成的，是上游接口改了没通知。',
  '昨晚那集太好看了，结局完全没想到。',
  '我觉得远程办公被高估了。',
  '这个方案太复杂了，先用最笨的办法跑通再说。',
  '他这个人说话总是绕，从不直接说要什么。',
  '这次事故的影响比我们一开始想的大。',
  '我很想接这个项目，但我手上已经有三个了。',
];

export async function render(root) {
  const bank = await Store.getBank();
  const sourceInput = el('input', { class: 'text-input lang', placeholder: '你想说的一句话（中文或简单英文）' });
  const fromBank = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const c = bank.chunks[Math.floor(Math.random() * bank.chunks.length)];
    if (c) sourceInput.value = c.gloss || c.chunk;
  } }, '从库里抽');
  const surprise = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    sourceInput.value = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  } }, '出题');

  const v1 = el('textarea', { class: 'text-area lang', rows: 2, placeholder: '跟朋友聊天…' });
  const v2 = el('textarea', { class: 'text-area lang', rows: 2, placeholder: '跟同事说 / 写邮件…' });
  const v3 = el('textarea', { class: 'text-area lang', rows: 2, placeholder: '正式汇报或写作，用最精确的词…' });
  const result = el('div');

  root.append(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', null, '一句三说')),
    el('p', { class: 'muted sm' }, '同一个意思按三个语域说三版（不许查词典），然后逐版点评。三版几乎一样 = 词还没激活。'),
    el('div', { class: 'input-row' }, sourceInput, el('div', { class: 'btn-row' }, fromBank, surprise)),
    el('label', { class: 'field' }, el('span', { class: 'field-label mono' }, 'V1 · CASUAL'), v1),
    el('label', { class: 'field' }, el('span', { class: 'field-label mono' }, 'V2 · NEUTRAL'), v2),
    el('label', { class: 'field' }, el('span', { class: 'field-label mono' }, 'V3 · PRECISE'), v3),
    el('button', { class: 'btn btn-primary', onclick: doReview }, '交三版 →'),
    result,
  ));

  async function doReview() {
    const sentence = sourceInput.value.trim();
    if (!sentence || !v1.value.trim() || !v2.value.trim() || !v3.value.trim()) {
      toast('句子和三版都要填', 'warn'); return;
    }
    result.textContent = '';
    result.append(el('div', { class: 'mono muted skeleton-inline' }, '点评中…'));
    const rr = llmConfigured()
      ? await paraphraseReview({ sentence, v1: v1.value, v2: v2.value, v3: v3.value })
      : null;
    const r = rr && rr.ok ? rr.data : null;
    result.textContent = '';
    let scores = { flexibility: null, precision: null, idiomaticity: null };
    if (!r) {
      result.append(el('div', { class: 'notice' }, rr ? `陪练离场（${reasonCN(rr.reason)}）——稍后再试。` : '陪练没上场——需要 node server.mjs 启动。'));
    } else {
      for (const [k, label] of [['v1', 'V1 casual'], ['v2', 'V2 neutral'], ['v3', 'V3 precise']]) {
        const it = r[k];
        if (!it) continue;
        result.append(el('div', { class: 'card' },
          el('div', { class: 'sec-label mono' }, label),
          it.issues ? el('div', { class: 'sm' }, it.issues) : null,
          it.improved ? el('div', { class: 'lang ex' }, it.improved) : null));
      }
      if (Array.isArray(r.awakened) && r.awakened.length) {
        result.append(el('div', { class: 'card' },
          el('div', { class: 'sec-label mono' }, '沉默词唤醒'),
          el('div', { class: 'lang' }, r.awakened.map((w) => `${w.word}（${w.where || ''}）`).join(' · ')),
          el('div', { class: 'muted sm' }, '你明明认识但没调用的词——反复出现（≥2 次）就该入库。')));
      }
      if (r.scores) scores = r.scores;
    }
    // 二次产出
    const second = el('textarea', { class: 'text-area lang', rows: 2, placeholder: '换一个情境，把 V3 的精华词重新组装再说一遍…' });
    const s1 = scoreInput('灵活性', scores.flexibility), s2 = scoreInput('精确度', scores.precision), s3 = scoreInput('地道度', scores.idiomaticity);
    result.append(el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '30 秒后 · 二次产出'),
      el('p', { class: 'muted sm' }, '间隔极近的第二次产出，激活效果翻倍。'),
      second,
      el('div', { class: 'score-row' }, s1, s2, s3),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        await Store.pushLog('paraphrase', {
          date: todayISO(), sentence,
          versions: [v1.value, v2.value, v3.value], second: second.value,
          scores: { flexibility: +s1.value, precision: +s2.value, idiomaticity: +s3.value },
          awakened: (r && r.awakened) || [],
        });
        toast('已记录');
        location.hash = '#/today';
      } }, '记录本场')));
  }
  function scoreInput(label, suggested) {
    const sel = el('select', { class: 'text-input sm-input' }, [0, 1, 2, 3, 4, 5].map((n) =>
      el('option', { value: n, selected: suggested === n }, String(n))));
    return el('label', { class: 'score-item' }, el('span', { class: 'field-label mono' }, label + ' 0-5'), sel);
  }
}
