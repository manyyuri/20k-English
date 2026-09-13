// bank.js — 语块库：活的索引。不是卡片墙，是词典式密集列表，行状态即激活状态。
import { el, clear, sheet, todayISO, toast } from '../util.js';
import { Store } from '../store.js';
import { stats, srsDueDate } from '../srs.js';

const TYPE_LABEL = { collocation: '搭配', phrasal: '短语动词', idiom: '习语', frame: '句式', single: '精确词' };

export async function render(root) {
  const bank = await Store.getBank();
  let st = stats(bank.chunks);
  let filter = 'all';
  let query = '';

  const listEl = el('div', { class: 'bank-list' });
  const countEl = el('div', { class: 'bank-count mono' });

  function apply() {
    const today = todayISO();
    st = stats(bank.chunks);
    let rows = bank.chunks;
    if (filter === 'due') rows = rows.filter((c) => srsDueDate(c) <= today);
    else if (filter === 'stubborn') rows = rows.filter((c) => (c.srs?.lapses || 0) >= 3);
    else if (filter === 'new') rows = rows.filter((c) => c.created >= todayISO(new Date(Date.now() - 7 * 86400000)));
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((c) => (c.chunk + ' ' + c.gloss + ' ' + (c.source || '')).toLowerCase().includes(q));
    }
    countEl.textContent = `${rows.length} / ${st.total}`;
    clear(listEl);
    if (!rows.length) {
      listEl.append(el('div', { class: 'muted empty-list' }, filter === 'all' && !query ? '库是空的。去收割一轮 →' : '没有符合条件的语块。'));
    }
    for (const c of rows) listEl.append(rowEl(c));
  }

  function rowEl(c) {
    const active = c.status === 'active';
    const lapses = c.srs?.lapses || 0;
    const iv = c.srs?.interval ?? 0;
    return el('div', { class: 'bank-row' + (active ? ' active' : ''), tabindex: '0', role: 'button',
      onclick: () => detailSheet(c), onkeydown: (e) => { if (e.key === 'Enter') detailSheet(c); } },
      el('div', { class: 'row-main' },
        el('span', { class: 'dot' + (active ? '' : ' learning'), title: active ? '已激活' : '学习中' }),
        lapses >= 3 ? el('span', { class: 'stubborn-flag', title: `lapse ×${lapses}` }, '!') : null,
        el('span', { class: 'chunk lang' }, c.chunk),
        el('span', { class: 'gloss' }, c.gloss)),
      el('div', { class: 'row-meta mono' },
        el('span', { class: 'type-tag' }, TYPE_LABEL[c.type] || c.type || '—'),
        `iv ${iv}d`),
    );
  }

  function detailSheet(c) {
    const s = c.srs || {};
    const content = el('div', { class: 'chunk-detail' },
      el('div', { class: 'detail-chunk lang' }, c.chunk),
      el('div', { class: 'muted' }, c.gloss || ''),
      c.register ? el('div', { class: 'sm' }, '语域：', c.register) : null,
      c.source ? el('div', { class: 'sm muted' }, '出自：', c.source) : null,
      (c.examples || []).length ? el('div', { class: 'examples' }, c.examples.map((e) => el('div', { class: 'ex lang' }, e))) : null,
      c.my_example ? el('div', { class: 'my-ex' }, el('div', { class: 'sec-label mono' }, '我的例句'), el('div', { class: 'lang' }, c.my_example)) : null,
      el('div', { class: 'srs-table mono' },
        row('id', c.id || '—'), row('status', c.status || 'learning'), row('ease', s.ease ?? '—'),
        row('interval', (s.interval ?? 0) + 'd'), row('reps', s.reps ?? 0), row('lapses', s.lapses ?? 0),
        row('streak', s.streak ?? 0), row('due', s.due || '今天'), row('created', c.created || '—')),
      el('div', { class: 'detail-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          if (!confirm(`删除「${c.chunk}」？`)) return;
          bank.chunks = bank.chunks.filter((x) => x.id !== c.id);
          await Store.saveBank(bank);
          sh.close(); apply(); refreshHead();
          toast('已删除');
        } }, '删除'),
      ),
    );
    const sh = sheet(content, { title: '' });
    function row(k, v) { return el('div', null, el('span', { class: 'k' }, k), el('span', { class: 'v' }, String(v))); }
  }

  function refreshHead() {
    const h = root.querySelector('.bank-head-count');
    if (h) h.textContent = `${st.active} active`;
  }
  refreshHead();

  const chips = [['all', '全部'], ['due', '到期'], ['stubborn', '顽固'], ['new', '本周新收']];
  const chipRow = el('div', { class: 'chip-row' }, chips.map(([k, label]) =>
    el('button', { class: 'chip' + (k === filter ? ' on' : ''), onclick: (e) => {
      filter = k;
      chipRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      e.currentTarget.classList.add('on');
      apply();
    } }, label)));

  root.append(el('div', { class: 'page bank-page' },
    el('div', { class: 'page-head' },
      el('h1', null, '语块库'),
      el('span', { class: 'bank-head-count mono muted' }, `${st.active} active`),
    ),
    el('div', { class: 'bank-tools' },
      el('input', { class: 'search', type: 'search', placeholder: '搜语块 / 释义 / 出处…',
        oninput: (e) => { query = e.target.value.trim(); apply(); } }),
      chipRow,
      countEl),
    listEl,
    el('button', { class: 'fab', title: '手动入库', onclick: () => location.hash = '#/harvest?mode=manual' }, '+'),
  ));
  apply();
}
