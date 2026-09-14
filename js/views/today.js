// today.js — 首页是一天的排期，不是 dashboard：上场前 / 今天这场戏 / 散场后。
// 用户是每天要上台的上班族：时间是从缝隙里抢的，尊严是不当学生。
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
    const second = pickSecond(weekday, scenario);

    const retry = (label) => el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
      await reconcilePi(); await draw();  // 对账后重画，状态即新
    } }, label);
    // 系统词汇红线：桥/探活/401 不许见人。用户只知道「陪练在不在场」。
    const notice =
      settings.piBridge === 'unreadable'
        ? el('div', { class: 'notice' },
            el('span', null, '陪练离场（服务没启动）——台词功照常，对戏和改稿等陪练回来。'),
            retry('重试'))
        : (h && !h.ok)
          ? el('div', { class: 'notice warn' },
              el('span', null, `陪练离场（${reasonCN(h.reason)}）——自己对词，台词功照常。`),
              retry(/401|403/.test(h.reason || '') ? '重连' : '重试'))
          : null;

    root.textContent = '';
    root.append(
      el('div', { class: 'page today' },
        el('div', { class: 'date-line mono' }, weekdayCN(weekday), ' · ', todayISO()),
        notice,

        // ---- 第一幕：上场前（台词功） ----
        st.total === 0
          ? el('div', { class: 'drill-card empty' },
              el('div', { class: 'eyebrow mono' }, '上场前 · 10 MIN'),
              el('h2', { class: 'lang' }, '第一场还没排'),
              el('p', { class: 'muted' }, '先测个底子：5 分钟词汇体检，看看哪些词你认识、却在会上调不出来。'),
              el('button', { class: 'btn', onclick: () => location.hash = '#/audit' }, '开考 →'),
            )
          : el('div', { class: 'drill-card' },
              el('div', { class: 'eyebrow mono' }, '上场前 · 10 MIN'),
              el('div', { class: 'drill-count' },
                el('span', { class: 'num lang' }, String(dueN)),
                el('span', { class: 'num-label' }, '个词等在这场'),
              ),
              el('div', { class: 'drill-sub' }, '台词功 · 被迫开口'),
              el('button', { class: 'btn btn-primary btn-block', onclick: () => location.hash = '#/drill' }, dueN > 0 ? '开演 →' : '看一眼班底 →'),
            ),

        // ---- 第二幕：今天这场戏 ----
        el('div', { class: 'sec-label mono' }, '今天这场戏 · 15 MIN'),
        el('a', { class: 'slot-card', href: second.href },
          el('div', { class: 'slot-main' },
            el('div', { class: 'slot-title' }, second.title),
            el('div', { class: 'slot-desc muted' }, second.desc),
          ),
          el('span', { class: 'slot-arrow' }, '→'),
        ),

        // ---- 第三幕：散场后 ----
        el('a', { class: 'immersion-link', href: '#/immersion' },
          '刚看完一集？', el('span', { class: 'muted' }, ' 散场后 10 分钟，趁热收尾 →')),

        // ---- 底部事实 ----
        el('div', { class: 'today-foot mono' },
          `班底 ${st.total} · 常驻 ${st.active}`, ' · ',
          `明日上场 ${st.dueTomorrow}`),
    ),
  );
  }
}

function pickSecond(weekday, scenario) {
  // 工作日 对戏/改稿 隔天轮换；周末 改稿 + 复盘（排期产品化，但说人话：这是场次，不是课程）
  if (weekday <= 4) {
    return weekday % 2 === 0
      ? { title: `对戏 · ${scenario.title}`, desc: scenario.desc, href: '#/speaking' }
      : { title: '改稿 · 一句三说', desc: 'casual / neutral / precise，唤醒沉默词', href: '#/paraphrase' };
  }
  return weekday === 5
    ? { title: '改稿 · 表达升级', desc: '写一篇真东西，审泛词密度与中式表达', href: '#/upgrade' }
    : { title: '复盘 · 本周战报', desc: '数字优先，低于红线只谈那一件事', href: '#/review' };
}
function weekdayCN(w) {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][w];
}
