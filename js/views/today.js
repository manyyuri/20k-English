// today.js — 首页是一次排好序的训练跑道，不是 dashboard。顺序即信息：drill 永远第一、最大。
import { el, todayISO, reasonCN } from '../util.js';
import { Store } from '../store.js';
import { dueList, stats } from '../srs.js';
import { reconcilePi } from '../pi.js';

const SCENARIOS = [
  { id: 'standup', title: 'Daily standup', desc: '汇报进度，被追问为什么又延期' },
  { id: 'review', title: 'Code review 争论', desc: '我对你的 PR 提出异议，你反驳' },
  { id: 'debate', title: '技术方案辩论', desc: 'monolith vs microservices、deadline 谈判' },
  { id: 'upward', title: '向上沟通', desc: '向 CTO 解释一次线上事故' },
  { id: 'show', title: '聊昨晚那集剧', desc: '复述剧情 + 评价角色动机' },
  { id: 'smalltalk', title: 'Pub small talk', desc: '寒暄、点餐、抱怨邻居装修' },
  { id: 'ielts', title: '雅思 Part 2/3', desc: '"Should kids learn to code?"' },
];

export async function render(root) {
  await draw(root);
  async function draw() {
  const bank = await Store.getBank();
  const st = stats(bank.chunks);
  const dueN = dueList(bank.chunks, 999).length;
  const settings = await Store.getSettings();
  const h = settings.llmHealth;

  const weekday = (new Date().getDay() + 6) % 7; // 0=Mon
  const rot = await Store.getRotation();
  const scenario = SCENARIOS[rot.scenarioIdx % SCENARIOS.length];
  const secondary = pickSecondary(weekday, scenario);

  const retry = (label) => el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
    await reconcilePi(); await draw();  // 对账后重画，状态即新
  } }, label);
  const notice =
    settings.piBridge === 'unreadable'
      ? el('div', { class: 'notice' },
          el('span', null, '模型桥需要 node server.mjs 启动——收割/评分/陪练不可用，drill 自评模式不受影响。'),
          retry('重试桥'))
      : (h && !h.ok)
        ? el('div', { class: 'notice warn' },
            el('span', null, `模型探活失败（${reasonCN(h.reason)}）——训练将降级自评。`),
            retry(/401|403/.test(h.reason || '') ? '重连桥' : '重试'))
        : null;

  root.textContent = '';
  root.append(
    el('div', { class: 'page today' },
      el('div', { class: 'date-line mono' }, weekdayCN(weekday), ' · ', todayISO()),
      notice,

      // ---- 主训练：drill ----
      st.total === 0
        ? el('div', { class: 'drill-card empty' },
            el('div', { class: 'eyebrow mono' }, 'DRILL'),
            el('h2', { class: 'lang' }, '语块库是空的'),
            el('p', { class: 'muted' }, '先收割一轮——贴一段最近看的字幕或小说，把「认识但用不出」的语块收进来。'),
            el('button', { class: 'btn', onclick: () => location.hash = '#/harvest' }, '去收割 →'),
          )
        : el('div', { class: 'drill-card' },
            el('div', { class: 'eyebrow mono' }, 'DRILL'),
            el('div', { class: 'drill-count' },
              el('span', { class: 'num lang' }, String(dueN)),
              el('span', { class: 'num-label' }, dueN === 1 ? '张到期' : '张到期'),
            ),
            el('div', { class: 'drill-sub' }, '产出式复习 · 10 分钟'),
            el('button', { class: 'btn btn-primary btn-block', onclick: () => location.hash = '#/drill' }, dueN > 0 ? '开始 →' : '看一眼库 →'),
          ),

      // ---- 次训练槽 ----
      el('div', { class: 'sec-label mono' }, '今天第二件事 · 15 MIN'),
      el('a', { class: 'slot-card', href: secondary.href },
        el('div', { class: 'slot-main' },
          el('div', { class: 'slot-title' }, secondary.title),
          el('div', { class: 'slot-desc muted' }, secondary.desc),
        ),
        el('span', { class: 'slot-arrow' }, '→'),
      ),

      // ---- 兴趣附加 ----
      el('a', { class: 'immersion-link', href: '#/immersion' },
        '看剧了？', el('span', { class: 'muted' }, ' 10 分钟收尾 →')),

      // ---- 底部事实 ----
      el('div', { class: 'today-foot mono' },
        `已激活 ${st.active} / ${st.total}`, ' · ',
        `明日到期 ${st.dueTomorrow}`),
    ),
  );
  }
}

function pickSecondary(weekday, scenario) {
  // 工作日 speaking/paraphrase 隔天轮换；周末 upgrade + 复盘（coach 的排程产品化）
  if (weekday <= 4) {
    return weekday % 2 === 0
      ? { title: 'Speaking · 情景陪练', desc: `场景：${scenario.title} — ${scenario.desc}`, href: '#/speaking' }
      : { title: 'Paraphrase · 一句三说', desc: 'casual / neutral / precise，唤醒沉默词', href: '#/paraphrase' };
  }
  return weekday === 5
    ? { title: 'Upgrade · 表达升级', desc: '写一篇真东西，审泛词密度与中式表达', href: '#/upgrade' }
    : { title: '复盘 · 本周战报', desc: '数字优先，低于红线只谈那一件事', href: '#/review' };
}
function weekdayCN(w) {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][w];
}
