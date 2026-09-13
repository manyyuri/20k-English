---
name: en20k-drill
description: 产出式间隔复习（SRS）核心训练：从 ../data/bank.json 取到期语块，用"中文情境→产出英文句"、"搭配补全"、"5 秒快速反应"三种题型逼用户主动说出英文，当场按 0-3 评分并更新排期。每天 10-15 分钟。触发词：复习、打卡、drill、今天的卡片、练卡、做复习。
---

# 产出式复习（en20k-drill）

## 铁律：方向永远是「想表达的意思 → 产出英文」
看着英文想中文的识别式复习对激活无效。每张卡都必须让用户**说出来或写出来**。

## 每次会话流程（10-15 分钟，10 张卡）
1. 取卡（路径相对于本 skill 目录）：
```bash
python3 scripts/srs.py due 10
```
2. 对每张卡随机选一种题型：
   - **A 情境产出**（50%，主力）：给一个中文情境（用户真实场景：standup、code review、聊昨晚的剧、点外卖），用户必须说出一个含目标语块的英文句子
   - **B 搭配补全**（25%）：给半截搭配（`a ___ learning curve`），用户补全并造句
   - **C 快速反应**（25%）：给中文意思，5 秒内说出语块——模拟口语实时检索压力
3. 评分：
   - **3**：脱口而出，搭配对，语域对
   - **2**：说出来了，有磕绊或小错
   - **1**：提示后才想起
   - **0**：想不起来
4. 反馈要诊断失败类型：**检索失败**（想不起）？**搭配错误**（`make a decision` vs `take a call` 记混）？**语域错误**（正式邮件里用了 `screw the pooch`）？
5. 更新排期：
```bash
python3 scripts/srs.py grade c-0042 3
# 或批量：python3 scripts/srs.py grade-batch "c-0042:3,c-0043:1"
```
6. 本次 0-1 分的语块，当场换一个情境让用户再造一句（第二次产出）
7. 结束时在 `../data/logs/drills.md` 追加一行：
   `YYYY-MM-DD | 10 卡 | 3:x 2:x 1:x 0:x | 顽固：chunk1, chunk2`

## srs.py 用法
```
python3 scripts/srs.py due [n]        # 到期卡片（逾期优先、lapse 多的优先）
python3 scripts/srs.py grade ID 0-3   # 单条评分并排期
python3 scripts/srs.py grade-batch "id:score,id:score"
python3 scripts/srs.py stats          # 库存与到期统计
python3 scripts/srs.py add --chunk "..." --gloss "..." [其他字段]
```
调度规则（SM-2 变体，脚本内置）：3 分间隔增长、2 分保持、1 分重来、0 分记 lapse。连续 3 个 3 分 → status 变 active。

## 纪律
- 每天最多 15 分钟，到点就停——间隔复习靠算法，不靠热情
- 连续拿 3 分的卡自动降频，不要拿简单卡填时间
- 如果 bank 为空，提示用户先跑 en20k-bank 收割一轮
