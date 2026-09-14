// speaking.js — 情景陪练：全程英文、有立场的对手、对话优先纠错留到最后。
// 精华在词汇复盘：TOT log → 候选表达 → 重说那句 → 可回流语块库。
import { el, clear, todayISO, toast, createRecognizer, analyzeText } from '../util.js';
import { Store } from '../store.js';
import { llmConfigured, speakingReply, totCandidates } from '../llm.js';
import { reasonCN } from '../util.js';
import { failAction } from '../pi.js';
import { addChunk } from '../srs.js';

const SCENARIOS = [
  { id: 'standup', title: 'Daily standup', persona: '你是团队的 tech lead，正在听 daily standup。用户是汇报进度的工程师。你追问细节：为什么 migration 又延期、还差多少、今天到底能合什么。' },
  { id: 'review', title: 'Code review 争论', persona: '你是一个固执的 senior 工程师，刚 review 了用户的 PR，对抽象层次和测试策略提出尖锐异议。用户要反驳或让步。你会引用具体的代码问题。' },
  { id: 'debate', title: '技术方案辩论', persona: '你是架构师，主张 monolith 先行，用户主张 microservices。你有真实论点（运维成本、团队规模、部署耦合），会逼迫用户做 trade-off。' },
  { id: 'upward', title: '向上沟通', persona: '你是 CTO，刚收到一次线上事故的初步汇报。你冷静但不耐烦，要用户说清楚：影响面、根因、防止复发的方案。你会打断绕圈子的话。' },
  { id: 'show', title: '聊昨晚那集剧', persona: '你是用户的好朋友，昨晚看了同一集剧，很兴奋。你复述自己的理解、评价角色动机，并追问用户的看法（"Wait, why do you think she did that?"）。会跑题聊八卦。' },
  { id: 'smalltalk', title: 'Pub small talk', persona: '你是 pub 里认识的 friendly 陌生人，聊天气、工作、周末计划、抱怨各自的邻居装修。轻松但会自然追问。' },
  { id: 'ielts', title: '雅思 Part 2/3', persona: '你是雅思口语考官，正式但不冷漠。先给一个 Part 2 话题卡让用户讲 1-2 分钟，然后追问 2-3 个 Part 3 抽象问题（要求论证）。' },
];

export async function render(root) {
  const settings = await Store.getSettings();
  if (!llmConfigured(settings.llm)) {
    root.append(el('div', { class: 'page drill-wrap' },
      el('div', { class: 'drill-done' },
        el('h2', { class: 'lang' }, '对手戏需要陪练'),
        el('p', { class: 'muted' }, '对手戏由陪练扮演——他会打断、追问、反对。用 node server.mjs 启动后自动上场。'),
        el('button', { class: 'btn btn-primary', onclick: () => location.hash = '#/settings' }, '去配置'))));
    return;
  }
  const rot = await Store.getRotation();
  pickView();

  // ---------- 场景选择 ----------
  function pickView() {
    clear(root);
    const comfortWarn = rot.sameCount >= 3
      ? el('div', { class: 'notice' }, `连续 ${rot.sameCount} 场「${rot.lastScenario}」——舒适区不产生激活，换一个。`)
      : null;
    root.append(el('div', { class: 'page' },
      el('div', { class: 'page-head' }, el('h1', null, 'Speaking')),
      comfortWarn,
      el('p', { class: 'muted sm' }, '全程英文。我扮演有立场的角色，会打断、追问、反对——对话优先，纠音留到最后。卡住了随时点「TOT」。'),
      SCENARIOS.map((s) =>
        el('div', { class: 'slot-card', tabindex: '0', role: 'button', onclick: () => startChat(s) },
          el('div', { class: 'slot-main' },
            el('div', { class: 'slot-title' }, s.title),
            el('div', { class: 'slot-desc muted' }, s.persona.slice(0, 40) + '…')),
          el('span', { class: 'slot-arrow' }, '→'))),
      el('div', { class: 'sec-label mono', style: 'margin-top:16px' }, '4/3/2 流利度专项'),
      el('p', { class: 'muted sm' }, '同一话题讲三遍：4 分钟 → 3 分钟 → 2 分钟。内容不变、时间收紧，逼出自动化。开聊后自己掐表即可。'),
    ));
  }

  // ---------- 对话 ----------
  async function startChat(scenario) {
    // 轮换 & 舒适区追踪
    if (rot.lastScenario === scenario.id) rot.sameCount++; else { rot.lastScenario = scenario.id; rot.sameCount = 1; }
    rot.scenarioIdx++;
    await Store.saveRotation(rot);

    const bank = await Store.getBank();
    const stubborn = bank.chunks
      .filter((c) => (c.srs?.lapses || 0) >= 2)
      .sort((a, b) => b.srs.lapses - a.srs.lapses).slice(0, 5).map((c) => c.chunk);

    const history = []; // {role, content}
    const tots = [];    // {wanted, candidates, chosen, rewritten}
    let userTexts = [];

    clear(root);
    const msgs = el('div', { class: 'chat-msgs' });
    const interim = el('div', { class: 'interim mono sm' });
    const input = el('textarea', { class: 'chat-input lang', rows: 2, placeholder: 'Your turn… (英文)' });
    const sendBtn = el('button', { class: 'btn btn-primary' }, '说');
    const micBtn = el('button', { class: 'mic-btn', title: '按住说话' }, '🎤');
    const recognizer = createRecognizer({
      onInterim: (t) => { interim.textContent = t; },
      onFinal: (t) => { input.value = (input.value + ' ' + t).trim(); interim.textContent = ''; },
    });
    if (recognizer.supported) {
      micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); micBtn.classList.add('live'); recognizer.start(); });
      const up = () => { micBtn.classList.remove('live'); recognizer.stop(); };
      micBtn.addEventListener('pointerup', up); micBtn.addEventListener('pointerleave', up);
    } else micBtn.disabled = true;

    function bubble(role, text) {
      msgs.append(el('div', { class: 'msg ' + (role === 'user' ? 'user' : 'them') },
        el('div', { class: 'msg-text lang' }, text)));
      msgs.scrollTop = msgs.scrollHeight;
    }

    async function send(autoText) {
      const text = (autoText ?? input.value).trim();
      if (!text) return;
      input.value = '';
      userTexts.push(text);
      history.push({ role: 'user', content: text });
      bubble('user', text);
      const thinking = el('div', { class: 'msg them' }, el('div', { class: 'msg-text mono muted' }, '…'));
      msgs.append(thinking); msgs.scrollTop = msgs.scrollHeight;
      const reply = await speakingReply(history, scenario.persona, stubborn);
      thinking.remove();
      if (!reply.ok) {
        toast(`陪练掉线（${reasonCN(reply.reason)}）`, 'warn', failAction(reply.reason));
        bubble('them', '(陪练没应上——重试一句，或点「结束」直接复盘。)');
        return;
      }
      history.push({ role: 'assistant', content: reply.text });
      bubble('them', reply.text);
    }
    sendBtn.addEventListener('click', () => send());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });

    root.append(el('div', { class: 'chat-page' },
      el('div', { class: 'd-top' },
        el('button', { class: 'd-exit', onclick: () => { if (confirm('结束对话，进入词汇复盘？')) endChat(); } }, '×'),
        el('span', { class: 'mono d-progress' }, scenario.title),
      ),
      msgs,
      el('div', { class: 'chat-bar' },
        el('div', { class: 'chat-tools' },
          el('button', { class: 'btn btn-ghost btn-sm tot-btn', onclick: () => logTot() }, 'TOT 卡住了'),
          el('button', { class: 'btn-text', onclick: () => { if (confirm('结束对话，进入词汇复盘？')) endChat(); } }, '结束 · 复盘')),
        el('div', { class: 'chat-input-row' }, micBtn, input, sendBtn),
        interim),
    ));

    // 开场白
    const opener = await speakingReply([{ role: 'user', content: '(开始吧，你先开场。)' }], scenario.persona, stubborn);
    if (opener.ok) { history.push({ role: 'assistant', content: opener.text }); bubble('them', opener.text); }
    else if (opener.reason !== 'noconfig') toast(`陪练掉线（${reasonCN(opener.reason)}）`, 'warn', failAction(opener.reason));

    function logTot() {
      const ta = el('textarea', { class: 'answer-input lang', rows: 2, placeholder: '你想说什么？（中文也行）' });
      const sh = sheet(el('div', null,
        el('div', { class: 'sec-label mono' }, 'TOT · 话到嘴边'),
        el('p', { class: 'muted sm' }, '记下你想表达的意思——复盘时给候选表达，你要挑一个重说那句。'),
        ta,
        el('button', { class: 'btn btn-primary', onclick: () => {
          const v = ta.value.trim();
          if (!v) return;
          tots.push({ wanted: v, candidates: null, chosen: null, rewritten: null });
          sh.close(); toast('已记下，继续对话');
        } }, '记下')));
    }

    async function endChat() {
      if (recognizer) recognizer.stop();
      const a = analyzeText(userTexts.join('\n'));
      const crutchTop3 = a.genericHits.slice(0, 3).map((g) => `${g.word}×${g.n}`);
      clear(root);

      // ---- TOT 复盘（精华） ----
      const totList = el('div', { class: 'form-col' });
      for (const t of tots) totList.append(await totCard(t));
      async function totCard(t) {
        const card = el('div', { class: 'card' },
          el('div', { class: 'sm' }, '想表达：', el('span', { class: 'lang' }, t.wanted)));
        const box = el('div', { class: 'mono sm skeleton-inline' }, '找候选…');
        card.append(box);
        totCandidates(t.wanted).then((r) => {
          box.remove();
          const cands = (r.ok && Array.isArray(r.data.candidates) && r.data.candidates) || [];
          if (!cands.length) {
            card.append(el('div', { class: 'muted sm' }, '陪练没给候选——自己写一个：'));
          } else {
            for (const c of cands) {
              card.append(el('div', { class: 'cand-pick' },
                el('label', null,
                  el('input', { type: 'radio', name: 'tot-' + tots.indexOf(t), value: c.en, onchange: (e) => { t.chosen = e.target.value; redraw(); } }),
                  el('span', { class: 'lang' }, c.en),
                  el('span', { class: 'muted sm' }, ' ' + (c.note || '')))));
            }
          }
          const manual = el('input', { class: 'text-input lang', placeholder: '或自己写候选…', oninput: (e) => { t.chosen = e.target.value; } });
          card.append(manual);
          const rw = el('textarea', { class: 'answer-input lang', rows: 2, placeholder: '用它重说那句（英文）' });
          const keep = el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
            t.rewritten = rw.value.trim();
            if (!t.rewritten || !t.chosen) { toast('先选表达、重说那句', 'warn'); return; }
            if (confirm(`把「${t.chosen}」招进班底？`)) {
              const bank2 = await Store.getBank();
              addChunk(bank2, { chunk: t.chosen, gloss: t.wanted, type: 'idiom', register: '口语; 来自 speaking TOT', source: 'speaking · ' + scenario.title, examples: [t.rewritten], my_example: t.rewritten });
              await Store.saveBank(bank2);
              toast(`已入库：${t.chosen}`);
            }
            card.classList.add('done');
          } }, '重说完成 · 可入库');
          card.append(rw, keep);
          function redraw() { /* radio change already sets t.chosen */ }
        });
        return card;
      }

      root.append(el('div', { class: 'page' },
        el('div', { class: 'page-head' }, el('h1', null, '词汇复盘')),
        el('div', { class: 'card' },
          el('div', { class: 'sec-label mono' }, '本场数据'),
          el('div', { class: 'kv mono' }, `场景：${scenario.title}`),
          el('div', { class: 'kv mono' }, `TOT：${tots.length} 次`),
          el('div', { class: 'kv mono' }, `拐杖词 Top3：${crutchTop3.join(' ') || '—'}`),
          el('div', { class: 'kv mono' }, `type-token 比：${a.ttr}`),
        ),
        tots.length ? el('div', { class: 'sec-label mono' }, 'TOT 逐条处理') : el('p', { class: 'muted' }, '本场没有记录 TOT——下次卡壳时点「TOT 卡住了」，那里才是精华。'),
        totList,
        el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          await Store.pushLog('speaking', {
            date: todayISO(), scenario: scenario.title, tot: tots.length,
            turns: userTexts.length, crutchTop3, ttr: a.ttr,
            tots: tots.map((t) => ({ wanted: t.wanted, chosen: t.chosen, rewritten: t.rewritten })),
          });
          toast('已记录');
          location.hash = '#/today';
        } }, '保存并结束'),
      ));
    }
  }
}
