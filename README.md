# en20k — 产出式词汇激活训练器

> 不是认识两万词，是灵活使用两万词。

一个把 `english-active-20k` agent skill 套件（8 个 skill）做成可用应用的实现。核心立场：**这不是背单词 App**。它是一个"语块账本 + 产出训练场"——每个界面决策都过同一个测试：*这帮用户产出，还是诱惑用户认出？*

## 运行

```bash
# 无构建、无依赖。任一静态服务器：
python3 -m http.server 8000
# 或
npx serve .

# 跑排期核心测试（node --test）：
npm test
```

首次打开 → 设置（右上角齿轮）→ 填一个 OpenAI 兼容端点（云上或本地 Ollama 均可，`http://localhost:11434/v1`）。

- **模型负责**：出情境题、开放产出评分、失败诊断、陪练对话、审稿
- **模型不负责**：SRS 排期。排期是确定性代码（`js/srs.js`，与 `skills/english-active-20k/en20k-drill/scripts/srs.py` 逐规则对齐），断网也照常运转（降级为自评）
- **数据**：全在本地（IndexedDB，localStorage 降级），导出的 `bank.json` 可直接喂给 agent skill 的 `srs.py`（`EN20K_BANK=path/to/bank.json python3 srs.py due`）——双向兼容

## 三个入口

| Tab | 内容 |
|---|---|
| **今日** | drill 卡（3 种题型：情境产出 50% / 搭配补全 25% / 快速反应 25%，15 分钟到点就停）+ 每日一个副场景（周一三五 speaking，周二四 paraphrase，周六 upgrade，周日复盘） |
| **库** | 语块账本：active（黄点）/learning、到期、顽固 Top、本周新收；点开看排期详情 |
| **复盘** | 退休进度（激活数 / 平均间隔）、周报、泛词密度与 TOT 趋势、月度体检入口 |

另有两个舞台：**收割**（贴材料 → 模型标候选 →「认识但用不出」确认 → 当场造句入库）、**体检**（识别抽样 → 产出抽样 → 自由产出 → 基线画像，分 2-3 次做完）。

## 纪律写进了产品

- 15 分钟时间盒到点即停，结束页写"到点就停"——不是"再来一组"
- 没有连续打卡、没有排行榜；替代物是"退休进度"：激活数上升、间隔变长
- drill 低于 5/7 天触发红线规则：整份周报只谈这一件事
- 每周新增 >60 警告——激活比囤积重要
- 荧光笔黄只出现在两处：检索成功、active 状态。别处不见黄色

## 视觉

见 `DESIGN.md`。纸白/墨色/荧光笔黄/批注红/图表蓝；衬线=语言内容、无衬线=界面、等宽=机器事实；签名交互是「检索成形」——待激活的词是虚影，答对时荧光笔划过、字成形（`prefers-reduced-motion` 降级为直接点亮）。

## 目录

```
index.html            壳（header + main + tabbar）
css/app.css           设计系统
js/app.js             hash 路由 + 舞台模式
js/srs.js             排期核心（srs.py 的忠实移植）
js/store.js           IndexedDB kv 存储 + bank.json 导入导出
js/llm.js             OpenAI 兼容适配层 + 各场景提示词（版本化）
js/words.js           体检用频段词表（5 段 × ~50-80 词）
js/util.js            el()/toast/sheet/文本分析/语音识别
js/views/*.js         today / drill / bank / harvest / review / audit / speaking / paraphrase / upgrade / immersion / settings
tests/srs.test.mjs    排期确定性测试
skills/english-active-20k/  原始 agent skills（单一事实源的另一半）
DESIGN.md             设计提案（为什么这样做）
sw.js / manifest      PWA
```

## 与 agent skill 的关系

应用与 `skills/english-active-20k/` 共享同一份 `bank.json` 格式与同一套排期规则。CLI 侧收割（跟 agent 对话）、手机上 drill；或反过来。见 `skills/english-active-20k/README.md`。
