---
name: en20k-bank
description: 从用户提供的英文材料（美剧/英剧台词、字幕、小说段落、技术文章、播客文稿）中收割"认识但用不出"的高价值语块（搭配、短语动词、习语、句式框架），逐条带 SRS 字段写入语块库 ../data/bank.json，并当场让用户造自己的例句。触发词：收割、挖语块、存语块、这段台词有什么可学的、bank this、chunk、语块入库。
---

# 语块收割机（en20k-bank）

## 原则
- 只收**语块**（chunk），不收孤立难词。母语者的流利来自成千上万个预制语块，不是单词表。
- 只收用户"认识但用不出"的；完全陌生的最多收 2-3 个最高频的。
- 每次收 8-12 条，宁缺毋滥。每周新增 ≤60 条——激活比囤积重要。

## 语块类型（type 字段）
1. **collocation**：`meet a deadline`、`a steep learning curve`、`blow out of proportion`
2. **phrasal**：`push back on`、`iron out the bugs`、`wing it`
3. **idiom**：`off the top of my head`、`read too much into it`
4. **frame**（句式框架）：`The way I see it, ...`、`Not that I know of.`、`It's not so much X as Y`
5. **single**（精确词）：仅当明显比用户已会的词更精确时收，如 `grueling`、`candid`、`backfire`

## 工作流
1. 接收材料：用户贴文本，或贴字幕/小说段落（如果只给剧名集数，让用户贴一段台词或剧情概要）
2. 通读，标出候选语块（判断标准：高频 + 用户用得上的场景——工作汇报、code review、日常聊天、聊剧）
3. **激活测试**：逐个问用户"这个你会自己用出来吗？"——认识但不会用的才收
4. 入库，用脚本添加（路径相对于本 skill 目录）：
```bash
python3 ../en20k-drill/scripts/srs.py add \
  --chunk "push back on" --gloss "对…提出异议" --type phrasal \
  --register "neutral; 职场高频" --source "Silicon Valley S2" \
  --example "We pushed back on the timeline." \
  --example "Don't be afraid to push back on scope creep." \
  --my-example "I'd push back on that design — it couples the services too tightly." \
  --tags work,tech
```
5. `my_example` 必须是用户当场造的**自己的句子**（工作/生活场景）。造错了不要悄悄改正——指出问题，让用户重造一次再入库。
6. 汇报本次收割清单（表格：语块 / 意思 / 语域 / 类型 / 出自哪里）

## 纪律
- 不收用户已能产出的语块
- 同义/近义语块成组收（`cut corners / half-ass it / phone it in`），在 gloss 里标注差异
- 从 en20k-speaking、en20k-upgrade、en20k-immersion 转来的候选项，同样走第 3-5 步
