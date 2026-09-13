// llm.js — LLM 边缘：情境生成、开放评分、失败诊断、陪练、审稿。
// 排期是算法的事（srs.js）；语言判断是模型的事（这里）。
// 未配置或失败 → 返回 null，调用方降级为自评/模板。
import { Store } from './store.js';

let cfgCache = null;
export async function llmConfig() {
  if (!cfgCache) cfgCache = (await Store.getSettings()).llm;
  return cfgCache;
}
export function resetCfgCache() { cfgCache = null; }
export function llmConfigured(cfg) {
  const c = cfg || cfgCache;
  return !!(c && c.baseUrl && c.model);
}

async function chat(messages, { temperature = 0.4, maxTokens = 1400, timeoutMs = 45000 } = {}) {
  const cfg = await llmConfig();
  if (!llmConfigured(cfg)) return null;
  let url = cfg.baseUrl.trim().replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: false };
    // GLM 系思考模型：不关思考，输出全进 reasoning_content，content 为空。
    // 这些任务（出题/评分/陪练）不需要思考链，关掉换低延迟。
    if (/glm|bigmodel/i.test(cfg.model + ' ' + cfg.baseUrl)) body.thinking = { type: 'disabled' };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const text = typeof msg?.content === 'string' && msg.content.trim()
      ? msg.content
      : (typeof msg?.reasoning_content === 'string' && msg.reasoning_content.trim() ? msg.reasoning_content : null);
    return text;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

function extractJSON(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const first = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i === -1 ? Infinity : i; }));
  if (!isFinite(first)) return null;
  const openCh = t[first], closeCh = openCh === '{' ? '}' : ']';
  const last = t.lastIndexOf(closeCh);
  if (last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch (e) { return null; }
}

async function chatJSON(system, user, opts) {
  const text = await chat([
    { role: 'system', content: system + '\n只输出一个合法 JSON 对象，不要输出任何其他文字。' },
    { role: 'user', content: user },
  ], { temperature: 0.2, ...opts });
  return extractJSON(text);
}

export async function testConnection() {
  const t = await chat([{ role: 'user', content: 'Reply with exactly: ok' }], { maxTokens: 8, temperature: 0 });
  return t != null;
}

// ---------------- prompts（版本化，视为产品逻辑） ----------------
// v1 · 收割：从材料抽候选语块
export async function harvestCandidates(text, source = '') {
  return chatJSON(
    '你是英语语块收割器。从用户材料里挑 8-12 个高价值语块（collocation/phrasal/idiom/frame/single）。' +
    '标准：高频 + 用户（中国程序员，日常看英美剧、读小说、写代码）在职场汇报、code review、日常聊天、聊剧场景里用得上。' +
    'frame 是句式框架（如 "The way I see it, ..."）。single 仅当明显比 good/bad 精确时收。' +
    '输出 JSON：{"candidates":[{"chunk":"...","gloss":"中文释义","type":"collocation|phrasal|idiom|frame|single","register":"口语/中性/正式 + 一句说明","example":"剧中/文中的原句或地道例句"}]}',
    `材料来源：${source || '未注明'}\n材料内容：\n${text.slice(0, 6000)}`,
  );
}

// v1 · Drill 题型 A：生成贴用户场景的中文情境
export async function genSituation(chunk) {
  return chatJSON(
    '你给一个英语语块出"情境产出"题。写一个具体的中文情境（1-2 句），是用户真实会说的话的场景：' +
    '程序员工作（standup、code review、和产品经理扯皮）、日常生活、聊昨晚的剧。情境要自然地逼出这个语块，但不要在情境里出现该语块的英文或直译。' +
    '输出 JSON：{"situation":"中文情境"}',
    `语块：${chunk.chunk}\n释义：${chunk.gloss}\n语域：${chunk.register || '未知'}\n用户自己的例句：${chunk.my_example || '无'}`,
  );
}

// v1 · Drill 评分 + 失败诊断
export async function gradeProduction({ chunk, qtype, prompt, answer, situation }) {
  return chatJSON(
    '你是严格的英语产出评分器。用户在练一个目标语块，按 0-3 评分：' +
    '3=脱口而出、搭配对、语域对；2=说出来了但有磕绊或小错；1=提示后才想起；0=想不起来/完全没用上目标语块。' +
    '再诊断失败类型：retrieval(检索失败)/collocation(搭配错误)/register(语域错误)/none。' +
    '反馈用中文，指出具体问题；给一个母语者版本。' +
    '输出 JSON：{"score":0,"diagnosis":"retrieval|collocation|register|none","feedback":"中文反馈，一两句","better":"母语者版本英文句"}',
    `目标语块：${chunk.chunk}（${chunk.gloss}）\n题型：${qtype}\n题目/情境：${situation || prompt || ''}\n用户的答案：${answer || '（空）'}`,
  );
}

// v1 · 检查用户造的例句（入库前）
export async function checkMyExample(chunk, sentence) {
  return chatJSON(
    '检查用户用目标语块造的英文句子。不替用户重写，只判断是否有错。' +
    '输出 JSON：{"ok":true,"issues":["具体问题，中文，没有问题则为空数组"]}',
    `目标语块：${chunk.chunk}（${chunk.gloss}，语域 ${chunk.register || '未知'}）\n用户句子：${sentence}`,
  );
}

// v1 · Speaking 对手戏
export function speakingSystem(scenario, stubborn = []) {
  return (
    '你是英语口语陪练的角色（不是老师），场景：' + scenario + '\n' +
    '规则：全程英文，保持真实语速；你有自己的立场，会打断、追问、反对、跑题；' +
    '每次回复 1-3 句，口语化，结尾经常用问题推进；绝不纠正用户的错误，绝不切中文；' +
    '如果用户明显卡壳或用中文求助，用更简单的英文换个说法继续，不主动给词汇答案' +
    (stubborn.length ? '\n如果有自然的语境，可以诱导用户使用这些他正在练的表达：' + stubborn.join(' / ') : '')
  );
}
export async function speakingReply(history, scenario, stubborn) {
  return chat(
    [{ role: 'system', content: speakingSystem(scenario, stubborn) },
      ...history.slice(-16).map((m) => ({ role: m.role, content: m.content }))],
    { temperature: 0.8, maxTokens: 300 },
  );
}

// v1 · TOT 候选表达
export async function totCandidates(wanted) {
  return chatJSON(
    '用户在英语对话中卡壳了（tip of the tongue）。他记下了"想说什么"（可能是中文）。' +
    '给 2-3 个候选英文表达（从自然口语到精确），每个配一句中文说明差别。' +
    '输出 JSON：{"candidates":[{"en":"...","note":"..."}]}',
    `想表达的意思：${wanted}`,
  );
}

// v1 · 一句三说点评
export async function paraphraseReview({ sentence, v1, v2, v3 }) {
  return chatJSON(
    '你是英语表达教练，点评"一句三说"。逐版检查：语法搭配、语域匹配（V1 朋友聊天/V2 同事邮件/V3 正式精确）、精确度。' +
    '唤醒沉默词：用户明明认识（C1+ 水平）但没调用的更精确的词，点名指出。' +
    '再给出你自己的地道三版。' +
    '输出 JSON：{"v1":{"issues":"中文点评","improved":"..."},"v2":{...},"v3":{...},"awakened":[{"word":"...","where":"用在哪"}],"scores":{"flexibility":0,"precision":0,"idiomaticity":0}}（三个分数 0-5：灵活性=三版差异度，精确度=V3 用词，地道度=搭配语感）',
    `原句/意思：${sentence}\nV1 casual：${v1}\nV2 neutral：${v2}\nV3 precise：${v3}`,
  );
}

// v1 · 表达升级三层审稿
export async function upgradeReview({ text, purpose }) {
  return chatJSON(
    '你是英文表达审稿人，按三层审稿：(1)语域是否匹配用途，先改最伤人的；(2)逐处升级泛词与拐杖词（very/really+adj、get/make/do/have、thing/stuff、a lot of、good/bad/nice）；(3)中式表达识别（直译结构、搭配错、名词化堆叠），并解释为什么。' +
    '保持用户原有结构和个人语气，只升级表达，不替用户重写。' +
    '输出 JSON：{"registerIssues":["中文，没有则为空"],"table":[{"orig":"...","better":"...","why":"中文一句"}],"rewrite":"整体升级版","patterns":["可复用模式 ×3，中文"]}',
    `用途与读者：${purpose}\n用户原文：\n${text.slice(0, 6000)}`,
  );
}

// v1 · 体检：产出方向评分（每词三项，各 0-2）
export async function auditGradeWord({ word, gloss, sentence, collocation, registerPick }) {
  return chatJSON(
    '你在测用户对一个词的产出掌握度。三项各 0-2 分：' +
    'sentence=用该词造句的质量（是否自然用到该词、搭配对）；collocation=说出的搭配是否常见且正确；register=语域判断是否正确。' +
    '输出 JSON：{"sentence":0,"collocation":0,"register":0,"feedback":"中文一句"}',
    `词：${word}（${gloss}）\n用户造句：${sentence || '（未作答）'}\n用户搭配：${collocation || '（未作答）'}\n用户语域判断：${registerPick || '（未选）'}\n参考：常见语域为该词在口语/中性/正式中的典型分布`,
  );
}
