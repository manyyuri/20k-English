// tests/srs.test.mjs — 排期核心的确定性测试（与 skills/english-active-20k/en20k-drill/scripts/srs.py 对齐）
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeOne, dueList, addChunk, stats, srsDueDate } from '../js/srs.js';

const mk = (n = 1) => ({ id: 'c-' + String(n).padStart(4, '0'), chunk: 'push back on', status: 'learning', srs: { due: '2025-01-01', interval: 0, ease: 2.5, reps: 0, lapses: 0, streak: 0 } });

test('score 3 间隔增长：0→1→3→round(3*ease)', () => {
  const c = mk();
  gradeOne(c, 3, '2025-01-01');
  assert.equal(c.srs.interval, 1);
  gradeOne(c, 3, '2025-01-02');
  assert.equal(c.srs.interval, 3);
  gradeOne(c, 3, '2025-01-05');
  // ease = 2.5 + 0.1 = 2.6 → round(3 * 2.6) = 8
  assert.equal(c.srs.interval, 8);
  assert.equal(c.srs.due, '2025-01-13');
});

test('连续 3 个 3 分 → active', () => {
  const c = mk();
  gradeOne(c, 3, '2025-01-01');
  gradeOne(c, 3, '2025-01-02');
  assert.equal(c.status, 'learning');
  gradeOne(c, 3, '2025-01-05');
  assert.equal(c.status, 'active');
});

test('score 2 保持间隔，score 1 重置为 1', () => {
  const c = mk();
  gradeOne(c, 3, '2025-01-01'); gradeOne(c, 3, '2025-01-02'); // interval 3
  gradeOne(c, 2, '2025-01-05');
  assert.equal(c.srs.interval, 3);
  gradeOne(c, 1, '2025-01-08');
  assert.equal(c.srs.interval, 1);
  assert.equal(c.srs.ease < 2.5, true);
});

test('score 0 记 lapse，active 降级 learning', () => {
  const c = mk();
  gradeOne(c, 3, '2025-01-01'); gradeOne(c, 3, '2025-01-02'); gradeOne(c, 3, '2025-01-05');
  assert.equal(c.status, 'active');
  gradeOne(c, 0, '2025-01-13');
  assert.equal(c.srs.lapses, 1);
  assert.equal(c.srs.interval, 0);
  assert.equal(c.status, 'learning');
});

test('due 排序：过期优先、久拖优先、lapse 多优先', () => {
  const a = mk(1); a.srs.due = '2025-01-01';
  const b = mk(2); b.srs.due = '2025-01-02'; b.srs.lapses = 2;
  const c = mk(3); c.srs.due = '2024-12-31';
  const future = mk(4); future.srs.due = '2025-06-01';
  const list = dueList([a, b, c, future], 10, '2025-01-05');
  // 主键 due 日期（早的先），同日才比 lapse：c(12-31) → a(01-01) → b(01-02)
  assert.deepEqual(list.map((x) => x.id), ['c-0003', 'c-0001', 'c-0002']);
  // 同日比 lapse：给 a 也放到 01-02，b 的 lapse=2 应排前
  a.srs.due = '2025-01-02';
  assert.deepEqual(dueList([a, b, c], 10, '2025-01-05').map((x) => x.id), ['c-0003', 'c-0002', 'c-0001']);
});

test('due TODAY / 缺失 → 永远到期', () => {
  assert.equal(srsDueDate({ srs: { due: 'TODAY' } }), '1970-01-01');
  assert.equal(srsDueDate({}), '1970-01-01');
});

test('addChunk：id 自增、默认值齐全、与 srs.py JSON 字段对齐', () => {
  const bank = { chunks: [] };
  const e1 = addChunk(bank, { chunk: 'meet a deadline', gloss: '赶上截止', my_example: 'We met the deadline.' });
  const e2 = addChunk(bank, { chunk: 'push back on', type: 'phrasal' });
  assert.equal(e1.id, 'c-0001');
  assert.equal(e2.id, 'c-0002');
  assert.equal(e2.type, 'phrasal');
  assert.equal(e1.status, 'learning');
  assert.equal(e1.srs.ease, 2.5);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e1.created));
  // bank.json 兼容性：可序列化、字段名与 python 端一致
  const round = JSON.parse(JSON.stringify(bank));
  assert.deepEqual(Object.keys(round.chunks[0]).sort(),
    ['chunk', 'created', 'examples', 'gloss', 'id', 'my_example', 'register', 'source', 'srs', 'status', 'tags', 'type'].sort());
});

test('stats：激活/到期/顽固 Top5', () => {
  const bank = { chunks: [] };
  addChunk(bank, { chunk: 'a' });
  addChunk(bank, { chunk: 'b' });
  addChunk(bank, { chunk: 'c' });
  const st = stats(bank.chunks, '2025-01-01');
  assert.equal(st.total, 3);
  assert.equal(st.active, 0);
  bank.chunks.forEach((c) => { c.srs.due = '2025-01-01'; });
  assert.equal(stats(bank.chunks, '2025-01-01').dueToday, 3);
  bank.chunks[0].srs.lapses = 3;
  bank.chunks[1].srs.lapses = 1;
  assert.equal(stats(bank.chunks, '2025-01-01').lapseKings[0].chunk, 'a');
});
