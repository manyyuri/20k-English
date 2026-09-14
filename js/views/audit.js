// audit.js — 月度体检向导：识别抽样 → 产出抽样 → 自由产出 → 基线画像。
// 分 2-3 次做完，每次 ≤20 分钟；状态随时保存。复测同结构、不同词。
import { el, clear, todayISO, shuffle, pick, analyzeText, toast, sheet, GENERIC_WORDS } from '../util.js';
import { Store } from '../store.js';
import { BANDS } from '../words.js';
import { llmConfigured, auditGradeWord } from '../llm.js';

const RECOG_BATCH = 10;
const PROD_N = 30;

export async function render(root) {
  let state = await Store.getAuditState();
  const page = el('div', { class: 'page audit-page' });
  root.append(page);
  draw();

  function save() { return Store.saveAuditState(state); }

  function draw() {
    clear(page);
    if (!state) page.append(intro());
    else if (state.step === 'recog') page.append(recogView());
    else if (state.step === 'prod') page.append(prodView());
    else if (state.step === 'free') page.append(freeView());
    else if (state.step === 'profile') page.append(profileView(state.profile));
  }

  // ---------- 0 · intro ----------
  function intro() {
    return el('div', { class: 'card' },
      el('div', { class: 'page-head' }, el('h1', null, '体检')),
      el('p', { class: 'muted' }, '区分「认识」和「会用」。三个阶段：识别抽样（80 词）、产出抽样（30 词）、自由产出（2 段）。产出基线画像，作为训练起点和跨月参照。'),
      el('ul', { class: 'muted sm steps-list' },
        el('li', null, '分 2-3 次做完，每次 ≤20 分钟，随时可退出续做'),
        el('li', null, '复测用相同结构、不同的词'),
        el('li', null, '识别 = 能说出中文大意；会用 = 能造句、说搭配、判语域')),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        state = {
          step: 'recog', startedAt: todayISO(),
          recog: {}, // bandKey -> { sample: [word,gloss][], answers: {word: known|vague|unknown} }
          prod: null, free: null, profile: null,
        };
        for (const b of BANDS) state.recog[b.key] = { sample: shuffle(b.words).slice(0, b.sample), answers: {} };
        await save(); draw();
      } }, '开始体检 →'),
    );
  }

  // ---------- 1 · recognition ----------
  function recogView() {
    const bandKeys = BANDS.map((b) => b.key);
    const cur = bandKeys.find((k) => {
      const r = state.recog[k];
      return Object.keys(r.answers).length < r.sample.length;
    });
    if (!cur) return finishRecog(); // 全部答完
    const band = BANDS.find((b) => b.key === cur);
    const r = state.recog[cur];
    const remaining = r.sample.filter(([w]) => !(w in r.answers));
    const batch = remaining.slice(0, RECOG_BATCH);
    const doneN = bandKeys.reduce((s, k) => s + Object.keys(state.recog[k].answers).length, 0);
    const totalN = bandKeys.reduce((s, k) => s + state.recog[k].sample.length, 0);

    return el('div', null,
      el('div', { class: 'page-head' },
        el('h1', null, '体检 · 识别'),
        el('span', { class: 'mono muted' }, `${doneN}/${totalN}`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${Math.round(doneN / totalN * 100)}%` })),
      el('div', { class: 'sec-label mono' }, band.label),
      el('p', { class: 'muted sm' }, '认识 = 能说出中文大意'),
      el('div', { class: 'recog-list' }, batch.map(([w]) =>
        el('div', { class: 'recog-row' },
          el('span', { class: 'lang recog-word' }, w),
          el('div', { class: 'recog-btns' },
            [['known', '认识'], ['vague', '模糊'], ['unknown', '不认识']].map(([v, label]) =>
              el('button', { class: 'chip' + (r.answers[w] === v ? ' on' : ''), onclick: async () => {
                r.answers[w] = v; await save(); draw();
              } }, label))),
        ))),
      el('button', { class: 'btn-text', onclick: () => location.hash = '#/today' }, '先到这里，下次继续 →'),
    );
  }

  function finishRecog() {
    // 从「认识」的词里按频段加权抽 30 个
    const pool = [];
    for (const b of BANDS) {
      const r = state.recog[b.key];
      const known = r.sample.filter(([w]) => r.answers[w] === 'known');
      const n = Math.round(known.length / Math.max(1, r.sample.length) * b.sample);
      pool.push(...pick(known, n).map(([w, g]) => ({ word: w, gloss: g, band: b.key })));
    }
    state.prod = { items: pick(pool, Math.min(PROD_N, pool.length)), idx: 0 };
    state.step = 'prod';
    save().then(draw);
    return el('div', { class: 'muted' }, '生成产出抽样…');
  }

  // ---------- 2 · production ----------
  function prodView() {
    const p = state.prod;
    if (p.idx >= p.items.length) {
      state.step = 'free'; state.free = { p1: '', p2: '' };
      save().then(draw);
      return el('div', { class: 'muted' }, '…');
    }
    const it = p.items[p.idx];
    const band = BANDS.find((b) => b.key === it.band);
    const sent = el('textarea', { class: 'answer-input lang', rows: 2, placeholder: `用 ${it.word} 造一个英文句子…` });
    const col = el('input', { class: 'text-input lang', placeholder: '1-2 个常见搭配（如 meet a deadline）' });
    const reg = el('select', { class: 'text-input' },
      el('option', { value: '' }, '这个词的语域…'),
      el('option', { value: 'casual' }, '口语'),
      el('option', { value: 'neutral' }, '中性'),
      el('option', { value: 'formal' }, '正式'),
    );
    const fb = el('div', { class: 'sm' });

    return el('div', null,
      el('div', { class: 'page-head' },
        el('h1', null, '体检 · 产出'),
        el('span', { class: 'mono muted' }, `${p.idx + 1}/${p.items.length}`)),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${Math.round(p.idx / p.items.length * 100)}%` })),
      el('div', { class: 'sec-label mono' }, band.label),
      el('div', { class: 'prod-word lang' }, it.word, el('span', { class: 'muted sm' }, `（${it.gloss}）`)),
      el('div', { class: 'form-col' },
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, '造句'), sent),
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, '常见搭配'), col),
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, '语域判断'), reg),
        fb,
        el('div', { class: 'input-row' },
          el('button', { class: 'btn btn-primary', onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            let scores = null;
            if (llmConfigured()) {
              const r = await auditGradeWord({ word: it.word, gloss: it.gloss, sentence: sent.value, collocation: col.value, registerPick: reg.options[reg.selectedIndex]?.text || '' });
              const d = r.ok ? r.data : null;
              if (d) {
                scores = { sentence: d.sentence ?? 0, collocation: d.collocation ?? 0, register: d.register ?? 0, feedback: d.feedback || '' };
                fb.append(el('div', { class: 'mono sm' }, `句 ${scores.sentence}/2 · 搭配 ${scores.collocation}/2 · 语域 ${scores.register}/2`),
                  scores.feedback ? el('div', { class: 'muted sm' }, scores.feedback) : null);
              }
            }
            if (!scores) {
              // 降级：自评
              const sh = sheet(el('div', null,
                el('div', { class: 'sm' }, '陪练离场 — 自评三项（0-2）'),
                selfGrade((s) => { it.scores = s; sh.close(); advance(); })));
            }
            if (scores) { it.scores = scores; advance(); }
            function advance() {
              p.idx++; save().then(draw);
            }
          } }, '提交 →'),
          it.scores ? null : el('button', { class: 'btn-text', onclick: () => { it.scores = { sentence: 0, collocation: 0, register: 0, feedback: '跳过' }; p.idx++; save().then(draw); } }, '不会，跳过')),
      ),
      el('button', { class: 'btn-text', onclick: () => location.hash = '#/today' }, '下次继续 →'),
    );

    function selfGrade(cb) {
      const sel = {};
      return el('div', { class: 'form-col' },
        [['sentence', '造句'], ['collocation', '搭配'], ['register', '语域']].map(([k, label]) =>
          el('label', { class: 'field' }, el('span', { class: 'field-label' }, label + ' 0-2'),
            sel[k] = el('select', { class: 'text-input' },
              [0, 1, 2].map((n) => el('option', { value: n }, String(n)))))),
        el('button', { class: 'btn btn-primary', onclick: () => cb({ sentence: +sel.sentence.value, collocation: +sel.collocation.value, register: +sel.register.value, feedback: '自评' }) }, '确定'));
    }
  }

  // ---------- 3 · free production ----------
  function freeView() {
    const f = state.free;
    const p1 = el('textarea', { class: 'text-area lang', rows: 5, placeholder: '英文：描述今天的工作 + 最近看的一集剧…' });
    const p2 = el('textarea', { class: 'text-area lang', rows: 5, placeholder: '英文：Remote work is overrated — agree or not? 必须论证…' });
    p1.value = f.p1 || ''; p2.value = f.p2 || '';
    const result = el('div');

    return el('div', null,
      el('div', { class: 'page-head' }, el('h1', null, '体检 · 自由产出')),
      el('p', { class: 'muted sm' }, '各 2 分钟，先说后写均可。写完看指标——拐杖词和 very/really 会现形。'),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, '① 今天的工作 + 最近一集剧'), p1),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, '② 观点论证'), p2),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        f.p1 = p1.value; f.p2 = p2.value;
        const a = analyzeText(p1.value + '\n' + p2.value);
        f.analysis = { ttr: a.ttr, density: a.density, topWords: a.topWords, genericHits: a.genericHits };
        f.crutch = a.genericHits.slice(0, 10).map((g) => g.word);
        await save();
        clear(result);
        result.append(el('div', { class: 'card' },
          el('div', { class: 'sec-label mono' }, '本地指标'),
          kvRow('type-token 比', a.ttr),
          kvRow('泛词密度', a.density),
          kvRow('very/really 等', a.genericHits.filter((g) => ['very', 'really'].includes(g.word)).reduce((s, g) => s + g.n, 0) + ' 次'),
          el('div', { class: 'sm', style: 'margin-top:8px' }, '高频实词：', el('span', { class: 'lang' }, a.topWords.slice(0, 10).map(([w, n]) => `${w}×${n}`).join(' · '))),
          el('div', { class: 'sm', style: 'margin-top:8px' }, '拐杖词 Top：', el('span', { class: 'lang' }, a.genericHits.slice(0, 10).map((g) => `${g.word}×${g.n}`).join(' · '))),
        ));
        result.append(el('div', { class: 'input-row', style: 'margin-top:12px' },
          el('button', { class: 'btn btn-primary', onclick: async () => {
            state.profile = buildProfile();
            state.step = 'profile';
            await save(); draw();
          } }, '生成画像 →')));
      } }, '分析'),
      result,
    );
    function kvRow(k, v) { return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, k), el('span', { class: 'kv-v mono' }, String(v))); }
  }

  // ---------- 4 · profile ----------
  function buildProfile() {
    const perBand = BANDS.map((b) => {
      const r = state.recog[b.key];
      const known = r.sample.filter(([w]) => r.answers[w] === 'known').length;
      const vague = r.sample.filter(([w]) => r.answers[w] === 'vague').length;
      const passiveRate = (known + vague * 0.5) / r.sample.length;
      const items = (state.prod?.items || []).filter((it) => it.band === b.key && it.scores);
      const prodRate = items.length
        ? items.reduce((s, it) => s + it.scores.sentence + it.scores.collocation + it.scores.register, 0) / (items.length * 6)
        : 0;
      return { key: b.key, label: b.label, size: b.size, passiveRate, prodRate };
    });
    const passive = Math.round(perBand.reduce((s, b) => s + b.size * b.passiveRate, 0));
    const overallProd = perBand.reduce((s, b) => s + b.prodRate * b.size * b.passiveRate, 0) / Math.max(1, perBand.reduce((s, b) => s + b.size * b.passiveRate, 0));
    const active = Math.round(passive * overallProd);
    const focus = [...perBand].filter((b) => b.passiveRate > 0.15).sort((a, b) => b.passiveRate * (1 - b.prodRate) - a.passiveRate * (1 - a.prodRate)).slice(0, 3);
    return {
      date: todayISO(),
      passive, active,
      activationRate: passive ? Math.round(active / passive * 100) + '%' : '—',
      overallProdRate: +overallProd.toFixed(2),
      perBand: perBand.map((b) => ({ ...b, passiveRate: +b.passiveRate.toFixed(2), prodRate: +b.prodRate.toFixed(2) })),
      crutch: state.free?.crutch || [],
      ttr: state.free?.analysis?.ttr ?? null,
      density: state.free?.analysis?.density ?? null,
      focus: focus.map((b) => b.label),
      target: `目标：${focus.map((b) => b.label).join('、')} 频段语块激活率 +10pt；整体激活率 → ${Math.min(90, Math.round((overallProd + 0.08) * 100))}%`,
    };
  }

  function profileView(p) {
    const cmpBox = el('div');
    Store.getProfile().then((prev) => {
      if (!prev) return;
      cmpBox.append(el('div', { class: 'sec-label mono' }, '对比上月'),
        kvRow('被动词汇', `${prev.passive} → ${p.passive}`),
        kvRow('主动词汇', `${prev.active} → ${p.active}`),
        kvRow('激活率', `${prev.activationRate} → ${p.activationRate}`),
      );
    });
    return el('div', null,
      el('div', { class: 'page-head' }, el('h1', null, '基线画像')),
      el('div', { class: 'card' },
        el('div', { class: 'retire-line' },
          el('span', { class: 'lang retire-num' }, p.activationRate),
          el('span', { class: 'muted sm' }, '激活率 = active / passive')),
        kvRow('被动词汇估计', `≈ ${p.passive}`),
        kvRow('主动词汇估计', `≈ ${p.active}`),
        kvRow('type-token 比', p.ttr ?? '—'), kvRow('泛词密度', p.density ?? '—'),
        cmpBox,
      ),
      el('div', { class: 'card' },
        el('div', { class: 'sec-label mono' }, '频段热力'),
        p.perBand.map((b) => el('div', { class: 'heat-row' },
          el('span', { class: 'heat-label mono' }, b.key),
          el('div', { class: 'heat-bars' },
            el('div', { class: 'bar thin' }, el('div', { class: 'bar-fill graph-fill', style: `width:${Math.round(b.passiveRate * 100)}%` })),
            el('div', { class: 'bar thin' }, el('div', { class: 'bar-fill marker-fill', style: `width:${Math.round(b.prodRate * b.passiveRate * 100)}%` }))),
          el('span', { class: 'mono sm muted' }, `${Math.round(b.passiveRate * 100)}% / ${Math.round(b.prodRate * 100)}%`),
        )),
        el('div', { class: 'muted sm' }, '上条=识别率（蓝），下条=产出率（黄）'),
      ),
      el('div', { class: 'card' },
        el('div', { class: 'sec-label mono' }, '最值得激活'),
        el('div', { class: 'lang' }, (p.focus || []).join('、') || '—'),
        el('div', { class: 'muted sm', style: 'margin-top:6px' }, p.target),
        p.crutch?.length ? el('div', { style: 'margin-top:8px' }, '拐杖词 Top：', el('span', { class: 'lang' }, p.crutch.join(' · '))) : null,
      ),
      el('div', { class: 'input-row' },
        el('button', { class: 'btn btn-primary', onclick: async () => {
          await Store.saveProfile(p);
          await Store.pushLog('audit', { date: todayISO(), profile: p });
          await Store.saveAuditState(null);
          state = null;
          toast('画像已保存');
          location.hash = '#/review';
        } }, '保存画像，完成体检'),
      ),
    );
    function kvRow(k, v) { return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, k), el('span', { class: 'kv-v mono' }, String(v))); }
  }
}
