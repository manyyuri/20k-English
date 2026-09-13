// srs.js — deterministic scheduling core, a faithful port of skills/english-active-20k/en20k-drill/scripts/srs.py
// 排期是算法的事，不交给模型。规则与 srs.py 完全一致：
//   3 分间隔增长、2 分保持、1 分重来、0 分记 lapse；连续 3 个 3 分 → status 变 active。

export const TYPES = ['collocation', 'phrasal', 'idiom', 'frame', 'single'];

// 纯 UTC 日期加法——与 srs.py 的 date 算术对齐，不受运行时区影响。
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function srsDueDate(chunk) {
  const due = chunk?.srs?.due;
  if (!due || due === 'TODAY') return '1970-01-01'; // python: due "TODAY" => today => always due
  return due;
}

export function gradeOne(chunk, score, today = new Date().toISOString().slice(0, 10)) {
  const s = (chunk.srs = chunk.srs || {});
  s.ease = s.ease ?? 2.5; s.interval = s.interval ?? 0;
  s.reps = s.reps ?? 0; s.lapses = s.lapses ?? 0;
  s.streak = s.streak ?? 0;
  if (score === 3) {
    s.reps += 1; s.streak = (s.streak || 0) + 1;
    s.ease = Math.min(3.0, s.ease + 0.05);
    const iv = s.interval;
    s.interval = iv === 0 ? 1 : iv === 1 ? 3 : Math.max(iv + 1, Math.round(iv * s.ease));
    if (s.streak >= 3) chunk.status = 'active';
  } else if (score === 2) {
    s.streak = 0; s.interval = Math.max(1, s.interval);
  } else if (score === 1) {
    s.streak = 0; s.ease = Math.max(1.3, s.ease - 0.15); s.interval = 1;
  } else {
    s.streak = 0; s.lapses += 1; s.ease = Math.max(1.3, s.ease - 0.2); s.interval = 0;
    if (chunk.status === 'active') chunk.status = 'learning';
  }
  s.due = addDaysISO(today, s.interval);
  s.last = today;
  return s;
}

export function dueList(chunks, n = 10, today = new Date().toISOString().slice(0, 10)) {
  const due = chunks.filter((c) => srsDueDate(c) <= today);
  due.sort((a, b) => {
    const da = srsDueDate(a), db = srsDueDate(b);
    if (da !== db) return da < db ? -1 : 1;
    const la = a.srs?.lapses || 0, lb = b.srs?.lapses || 0;
    if (la !== lb) return lb - la;
    const sa = a.status === 'learning' ? 0 : 1, sb = b.status === 'learning' ? 0 : 1;
    return sa - sb;
  });
  return due.slice(0, n);
}

export function addChunk(bank, fields = {}) {
  const chunks = bank.chunks;
  let max = 0;
  for (const c of chunks) { const m = /^c-(\d+)$/.exec(c.id || ''); if (m) max = Math.max(max, +m[1]); }
  const id = 'c-' + String(max + 1).padStart(4, '0');
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    id,
    type: TYPES.includes(fields.type) ? fields.type : 'collocation',
    chunk: fields.chunk || '',
    gloss: fields.gloss || '',
    register: fields.register || '',
    source: fields.source || '',
    examples: fields.examples || [],
    my_example: fields.my_example || '',
    status: 'learning',
    tags: fields.tags || [],
    created: today,
    srs: { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0, streak: 0 },
  };
  chunks.push(entry);
  return entry;
}

export function stats(chunks, today = new Date().toISOString().slice(0, 10)) {
  const learning = chunks.filter((c) => c.status !== 'active');
  const active = chunks.filter((c) => c.status === 'active');
  const dueToday = chunks.filter((c) => srsDueDate(c) <= today);
  const tm = addDaysISO(today, 1);
  const dueTomorrow = chunks.filter((c) => srsDueDate(c) === tm);
  const byType = {};
  for (const c of chunks) byType[c.type || '?'] = (byType[c.type || '?'] || 0) + 1;
  const lapseKings = [...chunks].sort((a, b) => (b.srs?.lapses || 0) - (a.srs?.lapses || 0)).slice(0, 5)
    .filter((c) => (c.srs?.lapses || 0) > 0);
  const avgIv = active.length
    ? Math.round(active.reduce((s, c) => s + (c.srs?.interval || 0), 0) / active.length)
    : 0;
  return { total: chunks.length, learning: learning.length, active: active.length, dueToday: dueToday.length, dueTomorrow: dueTomorrow.length, byType, lapseKings, avgIv };
}
