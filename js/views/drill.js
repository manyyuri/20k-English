// drill.js — 产出式复习舞台。全屏单卡，导航消失。
// 铁律：方向永远是「想表达的意思 → 产出英文」。没有看词认义模式。
import { el, clear, todayISO, fmtDur, toast, createRecognizer } from '../util.js';
import { Store } from '../store.js';
import { dueList, gradeOne, stats } from '../srs.js';
import { llmConfigured, genSituation, gradeProduction } from '../llm.js';

const TIMEBOX = 15 * 60 * 1000; // 到点就停
const MAX_CARDS = 10;
const DIAG = { retrieval: '检索失败', collocation: '搭配错误', register: '语域错误' };

export async function render(root) {
  const bank = await Store.getBank();
  if (bank.chunks.length === 0) {
    root.append(emptyBank());
    return;
  }
  const queue = dueList(bank.chunks, MAX_CARDS);
  if (queue.length === 0) {
    const st = stats(bank.chunks);
    root.append(el('div', { class: 'page drill-wrap' },
      el('div', { class: 'drill-done' },
        el('div', { class: 'eyebrow mono' }, 'DRILL'),
        el('h2', { class: 'lang' }, '今日无到期卡。'),
        el('p', { class: 'muted' }, `库里有 ${st.total} 个语块，${st.active} 个已激活。`),
        el('p', { class: 'mono muted sm' }, `下一批：${nextDueHint(bank)}`),
        el('button', { class: 'btn btn-primary', onclick: () => location.hash = '#/harvest' }, '收割新语块 →'),
      )));
    return;
  }

  const sess = { i: 0, cards: [], start: Date.now(), ended: false };
  const view = el('div', { class: 'drill-stage' });
  root.append(view);
  let timerId = null;
  let recognizer = null;

  function tick() {
    const elapsed = Date.now() - sess.start;
    const t = view.querySelector('.d-timer');
    if (t) {
      t.textContent = fmtDur(elapsed);
      t.classList.toggle('over', elapsed > TIMEBOX);
    }
    if (elapsed > TIMEBOX && !sess.ended) finish(true);
  }
  timerId = setInterval(tick, 1000);

  function cleanup() {
    clearInterval(timerId);
    if (recognizer) recognizer.stop();
  }

  function next() {
    sess.i++;
    if (sess.i >= queue.length) return finish(false);
    renderCard();
  }

  async function finish(timeout) {
    if (sess.ended) return;
    sess.ended = true;
    cleanup();
    await Store.saveBank(bank);
    const st = stats(bank.chunks);
    const logs = await Store.getLogs();
    const week = countDrillDaysThisWeek(logs);
    const counts = { 3: 0, 2: 0, 1: 0, 0: 0 };
    const stubborn = [];
    for (const c of sess.cards) { counts[c.score] = (counts[c.score] || 0) + 1; if (c.score <= 1) stubborn.push(c.chunk); }
    await Store.pushLog('drill', {
      date: todayISO(), duration: Date.now() - sess.start, timeout: !!timeout,
      n: sess.cards.length, counts, stubborn,
      cards: sess.cards.map((c) => ({ id: c.id, chunk: c.chunk, qtype: c.qtype, score: c.score, diagnosis: c.diagnosis || null, secondAttempt: c.secondAttempt || null })),
    });
    clear(view);
    view.append(el('div', { class: 'drill-done' },
      el('h2', { class: 'lang big' }, `今日 ${sess.cards.length} 卡。`),
      el('div', { class: 'mono muted' },
        `3:${counts[3]} 2:${counts[2]} 1:${counts[1]} 0:${counts[0]}`, el('br'),
        `明日到期 ${st.dueTomorrow} · 本周 ${week}/7`),
      stubborn.length ? el('p', { class: 'sm' }, '顽固：', el('span', { class: 'lang ghost-list' }, stubborn.join(' · '))) : null,
      el('p', { class: 'lang stop-line' }, '到点就停。'),
      el('button', { class: 'btn btn-ghost', onclick: () => location.hash = '#/today' }, '回今日'),
    ));
  }

  function renderCard() {
    if (recognizer) recognizer.stop();
    const chunk = queue[sess.i];
    const qtype = pickQType(chunk);
    clear(view);
    const situationBox = el('div', { class: 'situation lang' });
    const promptBox = el('div', { class: 'q-prompt' });
    const input = el('textarea', { class: 'answer-input lang', rows: 3, placeholder: '说出 / 写出英文…', 'aria-label': '你的英文产出' });
    const interim = el('div', { class: 'interim mono' });
    const micBtn = el('button', { class: 'mic-btn', 'aria-label': '按住说话', title: '按住说话' }, '🎤');
    const submitBtn = el('button', { class: 'btn btn-primary' }, '揭晓');
    const revealBox = el('div', { class: 'reveal-box' });

    // ---------- 题面 ----------
    if (qtype === 'A') {
      promptBox.append(el('div', { class: 'q-type mono' }, 'A · 情境产出'));
      situationBox.textContent = '…';
      situationBox.classList.add('skeleton');
      genSituation(chunk).then((r) => {
        situationBox.classList.remove('skeleton');
        if (r && r.situation) situationBox.textContent = r.situation;
        else situationBox.textContent = fallbackSituation(chunk);
      });
      promptBox.append(el('div', { class: 'q-target' }, '⌁ ', el('span', { class: 'lang target-chunk' }, chunk.chunk)));
    } else if (qtype === 'B') {
      const { masked, word } = maskChunk(chunk.chunk);
      promptBox.append(el('div', { class: 'q-type mono' }, 'B · 搭配补全'));
      promptBox.append(el('div', { class: 'q-mask lang' }, masked));
      promptBox.append(el('div', { class: 'muted sm' }, `（${chunk.gloss}）补全，并用它造一句`));
    } else {
      promptBox.append(el('div', { class: 'q-type mono' }, 'C · 快速反应'));
      promptBox.append(el('div', { class: 'q-gloss lang' }, `「${chunk.gloss}」`));
      const barWrap = el('div', { class: 'cbar-wrap' }, el('div', { class: 'cbar' }));
      promptBox.append(barWrap);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const bar = barWrap.querySelector('.cbar');
        bar.style.width = '0%';
      }));
      const to = setTimeout(() => { if (view.contains(input)) reveal(true); }, 5200);
      view.dataset.ctimer = to;
    }

    // ---------- 语音 ----------
    recognizer = createRecognizer({
      onInterim: (t) => { interim.textContent = t; },
      onFinal: (t) => { input.value = (input.value + ' ' + t).trim(); interim.textContent = ''; },
    });
    if (recognizer.supported) {
      micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); micBtn.classList.add('live'); recognizer.start(); });
      const up = () => { micBtn.classList.remove('live'); recognizer.stop(); };
      micBtn.addEventListener('pointerup', up);
      micBtn.addEventListener('pointerleave', up);
    } else { micBtn.disabled = true; micBtn.title = '此浏览器不支持语音输入'; }

    submitBtn.addEventListener('click', () => reveal(false));

    view.append(
      el('div', { class: 'd-top' },
        el('button', { class: 'd-exit', 'aria-label': '退出', onclick: () => { if (confirm('结束本次复习？已评分的卡会保留。')) finish(false); } }, '×'),
        el('span', { class: 'mono d-progress' }, `${sess.i + 1} / ${queue.length}`),
        el('span', { class: 'mono d-timer' }, '00:00'),
      ),
      el('div', { class: 'd-card' }, promptBox, situationBox,
        input, el('div', { class: 'input-row' }, micBtn, interim, submitBtn),
        revealBox),
    );
    input.focus();

    // ---------- 揭晓 ----------
    async function reveal(timedOut) {
      const ct = view.dataset.ctimer;
      if (ct) { clearTimeout(+ct); delete view.dataset.ctimer; }
      if (recognizer) recognizer.stop();
      const answer = input.value.trim();
      input.disabled = true;
      submitBtn.disabled = true;
      micBtn.disabled = true;
      // 检索成形：荧光笔划过，字从虚到实
      const target = el('span', { class: 'reveal-mark lang' }, chunk.chunk);
      revealBox.append(
        el('div', { class: 'reveal-chunk' }, target),
        chunk.examples && chunk.examples.length
          ? el('div', { class: 'examples' }, chunk.examples.map((e) => el('div', { class: 'ex lang' }, e)))
          : null,
        timedOut ? el('div', { class: 'mono sm alarm-text' }, '超过 5 秒 — 检索压力下没调出来') : null,
      );
      if (qtype === 'A') {
        const t = promptBox.querySelector('.target-chunk');
        if (t) t.classList.add('was-target');
      }
      // LLM 判分建议（异步，不阻塞按钮）
      const advice = el('div', { class: 'llm-advice mono sm skeleton-inline' }, '评分中…');
      revealBox.append(advice);
      let suggestion = null;
      if (llmConfigured()) {
        suggestion = await gradeProduction({
          chunk, qtype, answer,
          situation: situationBox.textContent || '',
          prompt: qtype === 'B' ? maskChunk(chunk.chunk).masked : chunk.gloss,
        });
      }
      advice.classList.remove('skeleton-inline');
      if (suggestion) {
        advice.innerHTML = '';
        advice.append(`模型建议：${suggestion.score} 分 · ${DIAG[suggestion.diagnosis] || '—'}`,
          suggestion.feedback ? el('div', { class: 'muted' }, suggestion.feedback) : null,
          suggestion.better ? el('div', { class: 'lang better-line' }, '母语者：', el('em', null, suggestion.better)) : null);
      } else {
        advice.textContent = llmConfigured() ? '模型评分失败 — 自评' : '自评模式';
      }
      // 评分按钮
      const gradeBox = el('div', { class: 'grade-grid' });
      const GRADES = [[3, '脱口而出'], [2, '有磕绊'], [1, '提示后才想起'], [0, '没想起来']];
      for (const [score, label] of GRADES) {
        gradeBox.append(el('button', {
          class: 'grade-btn' + (suggestion && suggestion.score === score ? ' suggested' : ''),
          onclick: () => onGrade(score, suggestion),
        }, el('span', { class: 'g-num lang' }, String(score)), el('span', { class: 'g-label' }, label)));
      }
      revealBox.append(gradeBox);
      revealBox.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    async function onGrade(score, suggestion) {
      gradeOne(chunk, score);
      await Store.saveBank(bank);
      const card = { id: chunk.id, chunk: chunk.chunk, qtype, score, diagnosis: null };
      sess.cards.push(card);
      if (score <= 1) renderDiagnose(card, suggestion);
      else next();
    }

    function renderDiagnose(card, suggestion) {
      const gb = view.querySelector('.grade-grid');
      if (gb) gb.remove();
      const advice = view.querySelector('.llm-advice');
      if (advice) advice.remove();
      const dbox = el('div', { class: 'diagnose-box' }, el('div', { class: 'sec-label mono' }, '哪一种失败？'));
      for (const [k, label] of Object.entries(DIAG)) {
        dbox.append(el('button', {
          class: 'btn btn-ghost diag-btn' + (suggestion && suggestion.diagnosis === k ? ' suggested' : ''),
          onclick: () => { card.diagnosis = k; renderSecond(card); },
        }, label));
      }
      dbox.append(el('button', { class: 'btn-text', onclick: () => next() }, '跳过 →'));
      revealBoxAppend(dbox);
    }

    function revealBoxAppend(node) {
      const rb = view.querySelector('.reveal-box');
      rb.append(node);
      rb.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    function renderSecond(card) {
      view.querySelectorAll('.diagnose-box').forEach((n) => n.remove());
      const hint = el('div', { class: 'situation lang skeleton' }, '…');
      revealBoxAppend(el('div', { class: 'second-box' },
        el('div', { class: 'sec-label mono' }, '当场第二次产出'),
        el('p', { class: 'muted sm' }, '换个情境，把它再说一次 —— 间隔极近的第二次产出，激活效果翻倍。'),
        hint,
        el('textarea', { class: 'answer-input lang second-input', rows: 2, placeholder: '用这个语块再造一句…' }),
        el('div', { class: 'input-row' },
          el('button', { class: 'btn btn-primary', onclick: () => {
            const v = view.querySelector('.second-input').value.trim();
            card.secondAttempt = v || null;
            next();
          } }, '下一张 →'),
        ),
      ));
      genSituation(chunk).then((r) => {
        hint.classList.remove('skeleton');
        hint.textContent = r && r.situation ? r.situation : fallbackSituation(chunk, true);
      });
    }
  }

  renderCard();
  return cleanup;
}

// ---------- helpers ----------
function pickQType(chunk) {
  const words = chunk.chunk.split(/\s+/).filter((w) => /^[a-zA-Z-]{3,}$/.test(w));
  const r = Math.random();
  if (r < 0.5) return 'A';
  if (r < 0.75 && words.length >= 1) return 'B';
  return words.length ? 'C' : 'A';
}
function maskChunk(text) {
  const words = text.split(/\s+/);
  let best = -1, bestLen = 0;
  words.forEach((w, i) => {
    const clean = w.replace(/[^a-zA-Z-]/g, '');
    if (clean.length >= 3 && clean.length > bestLen) { best = i; bestLen = clean.length; }
  });
  if (best < 0) return { masked: text, word: '' };
  const masked = [...words];
  masked[best] = masked[best].replace(/[a-zA-Z-]{3,}/, '┄┄┄┄');
  return { masked: masked.join(' '), word: words[best] };
}
function fallbackSituation(chunk, second = false) {
  if (second) return '再换个场景（跟同事解释 / 跟朋友吐槽），把它说出来。';
  return `想表达「${chunk.gloss || chunk.chunk}」这个意思 — 用它说一句你今天真实会说的话（工作 / 生活 / 聊剧）。`;
}
function nextDueHint(bank) {
  const dates = bank.chunks.map((c) => c.srs?.due).filter(Boolean).sort();
  if (!dates.length) return '—';
  const today = todayISO();
  for (const d of dates) if (d > today) return d;
  return dates[0];
}
function countDrillDaysThisWeek(logs) {
  const start = todayISO(weekStartDate());
  const days = new Set((logs.drill || []).filter((l) => l.date >= start).map((l) => l.date));
  return days.size;
}
function weekStartDate() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - (t.getDay() + 6) % 7);
  return t;
}
function emptyBank() {
  return el('div', { class: 'page drill-wrap' },
    el('div', { class: 'drill-done' },
      el('h2', { class: 'lang' }, '语块库是空的'),
      el('p', { class: 'muted' }, '间隔复习吃的是语块库。先去收割一轮，再回来。'),
      el('button', { class: 'btn btn-primary', onclick: () => location.hash = '#/harvest' }, '去收割 →')));
}
