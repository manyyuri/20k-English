// inbox.js — 收割收件箱：agent 在终端/对话里收割的语块写进 inbox.json，
// app 打开时弹出确认表，一次点选入库。保留最低限度的收割纪律：
// 默认全选，但每一行都能跳过——已会用的别囤。
import { el, toast, sheet } from './util.js';
import { Store } from './store.js';

export async function checkInbox() {
  let data;
  try {
    const r = await fetch('./api/inbox');
    if (!r.ok) return;
    data = await r.json();
  } catch (e) { return; }   // 静态部署无此端点，安静跳过
  const chunks = (data && data.chunks) || [];
  if (!chunks.length) return;

  const picked = new Set(chunks.map((_, i) => i));
  const countBtn = el('button', { class: 'btn btn-primary' }, `入库（${chunks.length}）`);
  const rows = chunks.map((c, i) => {
    const row = el('label', { class: 'inbox-row on' },
      el('input', { type: 'checkbox', checked: true, onchange: (e) => {
        e.target.checked ? picked.add(i) : picked.delete(i);
        row.classList.toggle('on', e.target.checked);
        countBtn.textContent = `入库（${picked.size}）`;
      } }),
      el('div', { class: 'inbox-main' },
        el('div', { class: 'chunk lang' }, c.chunk),
        el('div', { class: 'muted sm' }, c.gloss || ''),
        c.examples && c.examples[0] ? el('div', { class: 'ex lang sm' }, c.examples[0]) : null));
    return row;
  });

  countBtn.addEventListener('click', async () => {
    if (!picked.size) { toast('一个都没选', 'warn'); return; }
    const sel = chunks.filter((_, i) => picked.has(i));
    const r = await Store.importBankText(JSON.stringify({ chunks: sel }));
    if (!r.ok) { toast('导入失败：' + r.error, 'warn'); return; }
    fetch('./api/inbox', { method: 'DELETE' }).catch(() => {});
    sh.close();
    toast(`已入库 ${r.added} 个（合并 ${r.merged}）——明早开始到期`);
    location.hash = '#/bank';
  });

  const sh = sheet(el('div', { class: 'inbox-sheet' },
    el('p', { class: 'muted sm' }, '收割收件箱——只留「认识但用不出」的，已会用的取消勾选。'),
    el('div', { class: 'inbox-list' }, rows),
    el('div', { class: 'btn-row' },
      countBtn,
      el('button', { class: 'btn btn-ghost', onclick: () => sh.close() }, '先不要')),
  ), { title: `收件箱 · ${chunks.length} 个语块` });
}
