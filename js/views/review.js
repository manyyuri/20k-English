// review.js — 复盘：数字优先，≤40 行。低于红线（5/7）时，整份报告只谈那一件事。
import { el, todayISO, weekStart, daysAgo } from '../util.js';
import { Store } from '../store.js';
import { stats } from '../srs.js';

export async function render(root) {
  const [bank, logs, profile] = await Promise.all([Store.getBank(), Store.getLogs(), Store.getProfile()]);
  const st = stats(bank.chunks);
  const weekStartDate = weekStart();
  const weekStartISO = todayISO(weekStartDate);
  const today = new Date();
  const weekday = (today.getDay() + 6) % 7; // 0=Mon
  const daysElapsed = weekday + 1;

  // ---- 本周事实 ----
  const drillSessions = (logs.drill || []).filter((l) => l.date >= weekStartISO);
  const drillDays = new Set(drillSessions.map((l) => l.date)).size;
  const graded = drillSessions.flatMap((l) => l.cards || []);
  const passRate = graded.length ? Math.round(graded.filter((c) => c.score >= 2).length / graded.length * 100) : null;
  const addedThisWeek = bank.chunks.filter((c) => (c.created || '') >= weekStartISO).length;
  const spk = (logs.speaking || []).filter((l) => l.date >= weekStartISO).length;
  const par = (logs.paraphrase || []).filter((l) => l.date >= weekStartISO).length;
  const upg = (logs.upgrade || []).filter((l) => l.date >= weekStartISO).length;
  const imm = (logs.immersion || []).filter((l) => l.date >= weekStartISO).length;

  // ---- 红线规则 ----
  const redline = daysElapsed >= 3 && drillDays < 5;

  // ---- 趋势数据 ----
  const densities = (logs.upgrade || []).slice(-10).map((l) => ({ date: l.date, v: l.density }));
  const totSeries = (logs.speaking || []).slice(-10).map((l) => ({ date: l.date, v: l.tot || 0 }));

  const page = el('div', { class: 'page review-page' },
    el('div', { class: 'page-head' }, el('h1', null, '复盘')),

    // ---- 红线：只谈这一件事 ----
    redline ? el('div', { class: 'redline-box' },
      el('div', { class: 'sec-label mono alarm-text' }, `红线 · 本周 ${drillDays}/${daysElapsed} 天`), el('br'),
      el('div', { class: 'lang' }, 'drill 断了。'), el('br'),
      el('span', { class: 'muted' }, '哪天断的，那天发生了什么？先把这一件事解决——其他都以后再说。'),
    ) : null,

    // ---- 退休进度 ----
    el('div', { class: 'card retire-card' },
      el('div', { class: 'sec-label mono' }, '退休进度'),
      el('div', { class: 'retire-line' },
        el('span', { class: 'lang retire-num' }, `${st.active}`),
        el('span', { class: 'lang retire-den' }, ` / ${st.total}`),
        el('span', { class: 'muted sm' }, '已激活')),
      el('div', { class: 'bar' }, el('div', { class: 'bar-fill marker-fill', style: `width:${st.total ? Math.round(st.active / st.total * 100) : 0}%` })),
      el('div', { class: 'mono sm muted' }, `平均间隔 ${st.avgIv}d — 间隔在变长，就是你变强的方式`),
    ),

    // ---- 本周战报 ----
    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, `本周战报 · ${weekStartISO.slice(5)} 起`),
      kv('drill 天数', `${drillDays}/7`),
      kv('本周新增语块', `${addedThisWeek}` + (addedThisWeek > 60 ? ' ⚠ 囤太多了，激活不过来' : '')),
      passRate != null ? kv('复习通过率', `${passRate}%`) : null,
      kv('speaking / paraphrase / upgrade / immersion', `${spk} / ${par} / ${upg} / ${imm}`),
      st.lapseKings.length ? el('div', { class: 'stubborn-line' },
        el('span', { class: 'sec-label mono' }, '顽固 Top5'),
        el('div', { class: 'lang' }, st.lapseKings.map((c) => c.chunk).join(' · ')),
        el('div', { class: 'muted sm' }, '下周在 speaking 场景里给它们设计自然使用机会')) : null,
    ),

    // ---- 趋势 ----
    el('div', { class: 'card' },
      el('div', { class: 'sec-label mono' }, '趋势'),
      trendBlock('泛词密度（upgrade）', densities, (d) => d.v.toFixed(3), true),
      trendBlock('TOT 次数（speaking）', totSeries, (d) => String(d.v), false),
    ),

    // ---- 体检 ----
    el('div', { class: 'card audit-card', onclick: () => location.hash = '#/audit' },
      el('div', { class: 'sec-label mono' }, '月度体检'),
      profile
        ? el('div', null,
            el('div', { class: 'sm' }, `上次：${profile.date} · 激活率 `, el('span', { class: 'lang' }, profile.activationRate)),
            el('div', { class: 'muted sm' }, '满一个月就复测——相同结构、不同的词，跨月可比。'))
        : el('div', null,
            el('div', { class: 'sm' }, '还没体检过'),
            el('div', { class: 'muted sm' }, '建基线是整套训练的起点。分 2-3 次做完，每次 ≤20 分钟。')),
      el('span', { class: 'slot-arrow' }, '→'),
    ),
  );
  root.append(page);

  function kv(k, v) {
    return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, k), el('span', { class: 'kv-v mono' }, v));
  }
  function trendBlock(label, data, fmt, lowerBetter) {
    if (!data.length) return el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, label), el('span', { class: 'kv-v mono muted' }, '暂无数据'));
    const max = Math.max(...data.map((d) => d.v), 0.001);
    const last = data[data.length - 1];
    const first = data[0];
    let delta = last.v - first.v;
    const good = lowerBetter ? delta <= 0 : delta >= 0;
    return el('div', { class: 'trend' },
      el('div', { class: 'kv' }, el('span', { class: 'kv-k' }, label),
        el('span', { class: 'kv-v mono' }, fmt(last), el('span', { class: good ? 'good-delta' : 'bad-delta' }, ` ${delta >= 0 ? '+' : ''}${lowerBetter ? delta.toFixed(3) : delta}`))),
      el('div', { class: 'spark' }, data.map((d) =>
        el('div', { class: 'spark-col', title: `${d.date}: ${fmt(d)}` },
          el('div', { class: 'spark-bar', style: `height:${Math.max(6, Math.round(d.v / max * 28))}px` }))),
      ),
    );
  }
}
