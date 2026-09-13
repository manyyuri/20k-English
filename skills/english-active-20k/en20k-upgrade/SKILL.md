---
name: en20k-upgrade
description: 英文表达升级审稿：分析用户自己写的英文（邮件、PR 描述、周报、博客、剧评、聊天记录）或口语转写，按"语域匹配 → 泛词/拐杖词升级 → 中式表达识别"三层审稿，逐处给出精确升级方案与搭配说明，追踪泛词密度趋势。触发词：帮我改英文、润色、upgrade、这封邮件地道吗、审我的英文、polish my English。
---

# 表达升级审稿（en20k-upgrade）

## 输入
用户贴一段**自己写的**英文（≥100 词最好）+ 说明用途和读者（给老板的邮件？PR 描述？博客？）。写给自己看的笔记不值得审——审"要给人看"的英文。

## 三层审稿（按顺序）

### 1. 先判语域是否匹配用途
正式邮件里的 `Hey, gonna...`、同事闲聊里的 `I would like to inquire` 都是错。这一层的错最伤人，先改。

### 2. 逐处升级泛词与拐杖词
扫描清单 = `../data/profile.md` 里的拐杖词 Top10 + 通用清单：
- `very/really + adj` → 单个精确形容词（very tired → exhausted / drained / wiped）
- 泛动词 get/make/do/have → 具体动词（get better → improve / recover / bounce back）
- 泛名词 thing/stuff/part → 具体名词
- `a lot of` → considerable / a great deal of / tons of（按语域选）
- good/bad/nice → 语境化精确词（a good excuse → a flimsy excuse）
- 名词化堆叠、被动句滥用（中式正式文体常见病）→ 改回动词句

### 3. 中式表达（Chinglish）识别
直译结构（`open the light`、`play my phone`）、搭配错（`make a conclusion` → `draw a conclusion`）、语序迁移。给母语者版本，**并解释为什么**（不改白不改，用户要带走规律）。

## 输出格式
```
## 升级表
| 原文 | 升级 | 为什么 |
|------|------|--------|

## 整体改写版（保持你的结构，只换表达）

## 三个本次学到的可复用模式
```

## 闭环
- 升级对里挑 3-5 个高频可复用的，问用户是否用 en20k-bank 入库
- 追加 `../data/logs/upgrade.md`：
  `日期 | 文本类型 | 词数 | 泛词密度（泛词数/总词数）| 新发现的拐杖词`
- **泛词密度是本系统核心指标**，目标 6 个月内降到基线的一半以下

## 纪律
- 改写版保持用户的结构和个人语气，只升级表达——不是替用户重写
- 不确定的语感判断要说明置信度，别把口语习惯当错误
