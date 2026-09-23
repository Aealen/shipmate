# Wise 重设计规格 · 跨页一致性裁定

> 复核范围：`docs/wise-redesign/` 下 P1 / P2 / P3 / P3c / P4 / P5 / P5b / P6 / P7 共 9 份规格。
> 唯一真相源：`wise/DESIGN.md`（已逐 token 核验）。
> **裁定原则**：多数派优先、与规范 token 语义一致者优先、正向语义归 positive 族、品牌绿 `#9fe870` 出现位收敛。落盘设计师执行时**以本文件裁定为准**，与本文件冲突的原文条目按下表修正。

## 0. 全站基准（速查）

| 项 | 统一基准 |
|---|---|
| TopBar | 白底 `canvas` #ffffff，高 **64px**，水平内距 **48px**，无边框无阴影 |
| Logo | 锚形图标 **24×24 `ink` #0e0f0c** + 字标 "ShipMate" **20px · Noto Sans SC 900 · ink** |
| 头像 | 直径 **40px** 圆，底 `ink` #0e0f0c，字「明」14px · 600 · `canvas-soft` #e8ebe6 |
| 面包屑 | 「Maxon 实验室 / ShipMate / 当前页」：上级 400 · `mute`，项目层 600 · `body`，当前层 600 · `ink` |
| 页面底色 | `canvas-soft` #e8ebe6 自 TopBar 下（y=64）通铺；项目名行与 Tab 行直接坐 sage 底 |
| 项目名 | 40px · Noto Sans SC 900 · ink，行高 48px，右随 12px `badge-positive` active 徽章 |
| 五 Tab | 左对齐、间距 32px、高 48px；字 16px，激活与非激活均 600（激活 ink / 非激活 body，hover ink）；指示条 3px 高、与文字等宽、pill 圆角、贴文字底，色 `primary` #9fe870 |
| 内容区 | 左右内距 **48px**（内容宽 1824） |
| 卡片 | 白 `canvas` #ffffff · `rounded.xl` 24px · 内距 24px · 无边框无阴影；hover 不承诺（P1 项目卡全卡可点击，允许轻阴影） |
| 进度/完成度条 | 轨道 `canvas-soft` #e8ebe6 · 填充 `positive` #2ead4b · 高 8px（紧凑场景 6px）· `rounded.pill`；诊断型分档条（P3c 置信度）按值 positive/warning/negative |
| 圆角三级 | 页面浮卡/按钮 24px（xl）；卡内块级子卡 16px（lg）；卡内行级容器/输入框 12px（md）；徽章一律 pill |
| 徽章字色 | `primary-pale` 底徽章字一律 `positive-deep` #054d28；`warning` 底徽章字一律 `warning-content` #4a3b1c；`negative-bg` 底徽章字一律白 #ffffff |
| actor 徽章 | 双态：human = `canvas-soft` 底 `body` 字；`ai:*` / `mcp:*` = `ink` 底 `canvas-soft` 字 |
| 链接 | 14px · 600 · `ink` + 下划线（offset 2px），全站无彩色链接 |

## 1. 问题与裁定表

| # | 问题 | 涉及页面 | 统一裁定 |
|---|---|---|---|
| 1 | TopBar 高度三种：64 / 56 / 60 | P1·P2·P3·P3c·P4·P6=64；P5·P7=56；P5b=60 | 统一 **64px**。P5 §1/§2.1、P5b §1、P7 §1 的高度改 64，相关 y 坐标顺延 |
| 2 | TopBar 与内容区水平内距三种：24 / 32 / 48 | P2·P3·P3c·P4 内容区=48；P1·P5·P5b·P6·P7=24；P5 看板区=32 | 统一 **48px**（TopBar 与内容区左缘对齐）。P5 列宽重算 =(1920−96−72)/4=438px；P5b/P6/P7 内容宽改 1824。注：此为对规范 `nav-bar` padding `{spacing.xl}`=24 的有意偏离（对齐内容区），落盘时按 48 执行 |
| 3 | Logo 不一致：P1 图标用 `primary` 绿；P5/P6 图标 20px、P5/P6/P7 字标 16px·600；P2/P3c/P4 为 24px 图标 + 20px·900 字标 | P1·P5·P5b·P6·P7 | 统一 **图标 24×24 `ink` #0e0f0c + 字标 "ShipMate" 20px · 900 · ink**。P1 图标绿改 ink（绿出现位收敛）；P5/P6/P7 字标改 900·20px；P5/P6 图标改 24px |
| 4 | 头像五种：40px ink 底 canvas-soft 字（P2/P3/P3c/P4）；36px ink 底白字（P1）；32px ink 底白字（P5/P7）；**36px `primary` 绿底**（P5b/P6）；字符「朗」（P6） | 全部九页 | 统一 **40px 圆 · 底 `ink` · 字「明」14px · 600 · `canvas-soft`**。P5b/P6 绿底废除（品牌绿不做头像底，绿出现位收敛）；P1/P5/P7 尺寸字色对齐；P6「朗」改「明」 |
| 5 | 面包屑字色层级混乱：P2/P3c 当前层 600 `body`；P5/P6 前级 400 `body`；P5b 当前层 400 `ink`；P3 缺「Maxon 实验室」层且写作 "ShipMate(本项目)" | P2·P3·P3c·P5·P5b·P6 | 统一三级式：**上级 400 · `mute` → 项目层 600 · `body` → 当前层 600 · `ink`**。P2/P3c 当前层 body→ink；P5/P5b/P6 前级 body→mute；P5b 当前层 400→600；P3 面包屑补「Maxon 实验室」前缀、去掉「(本项目)」后缀 |
| 6 | 项目上下文条底色两种模式：坐 sage 底（P2/P3/P3c）vs 与 TopBar 连成白带（P4 内容区 sage 自 y=200 起；P5b 白带 60–132；P6 白带 64–160）；P4 头部 y=80 与其他页 y=88 不齐 | P4·P5b·P6 | 统一坐 sage：**页面底 `canvas-soft` 自 y=64 通铺，项目名行与 Tab 行直接坐在 sage 上**（P2 定案，P3/P3c 已引用）。P4/P5b/P6 白带取消、sage 上移；P4 头部 y=80→88（顶部内距 24） |
| 7 | Tab 形制不一：P5/P5b/P6 为均分整行、字 14px、非激活 400、指示条偏移 6px/2px、P6 指示条圆角 2px；P2/P3/P3c/P4 为左对齐 32px 间距、16px、均 600、指示条贴底 | P5·P5b·P6 | 统一 **左对齐、间距 32px、行高 48px、字 16px、激活与非激活均 600（激活 ink/非激活 body）、指示条 3px 高与文字等宽 pill 贴文字底**。P5/P5b/P6 的均分布、14px、400 非激活、指示条偏移与方角全部改（「保持现状均布」让位于 P2 定案的「替换现状全宽均布」） |
| 8 | 页面主标题/项目名字号不一：40px（P2/P3/P3c/P4）/ 32px（P6）/ 28px（P5/P5b 项目名、P7 页标题） | P5·P5b·P6·P7 | 统一 **40px · 900 · 行高 48px**（规范 `display-md` 字号档，中文行高放大约定）。P5/P5b 项目名、P6 项目名、P7「MCP 接入」页标题改 40px，相应行高与区块 y 坐标顺延 |
| 9 | 卡标题与统计数字字号混乱：卡标题 16px（P3c/P4/P7）/ 20px（P2/P5b）/ 24px·600（P6）；统计数字 32px·行高40（P2）/ 32·36（P5b）/ **40px·行高34（P6，行高<字号有裁切风险）**；P4 变更历史标题 24px·900 | P6·P5b·P4 | 统一层级：**区头/卡标题 20px · 600**（P6 的 24/600 改 20/600）；卡内小节标题 16px · 600（P3c/P4/P7 维持）；栏级大标题 24px · 900 仅限 P3c「分析产出」与 P4「变更历史」；**统计卡数字 32px · 900 · 行高 40**（P6 的 40/34 改 32/40，P5b 行高 36→40） |
| 10 | **confirmed 已确认三种定案**：badge-positive（P2/P3/P4）vs ink 底反白徽章（P3c §5）vs ink 点/canvas-soft 底 ink 字徽章（P5b 分布条、图例、§5） | P3c·P5b（对 P2/P3/P4） | 统一 **positive 族**：徽章 = `badge-positive`（`primary-pale` 底 + `positive-deep` 字）；状态点/分段条/图例 = `positive-deep` #054d28；指标数字 = `positive-deep`（P2 维持）。P3c §5 confirmed 行改 badge-positive；P5b 堆叠条 confirmed 段与图例点 ink→`positive-deep`、§5 徽章改 badge-positive 配色。连带：P3 §5 状态点对调——**done 点 = `positive` #2ead4b、confirmed 点 = `positive-deep` #054d28**（done 徽章与 confirmed 徽章同为 badge-positive，靠文字与 ✓ 前缀区分；28px 头部大徽章允许 ✓ 前缀，24px 列表 pill 不加） |
| 11 | **developing 进行中四种**：warning 族（P3/P3c）vs ink 中性点（P1 统计行）vs `primary-neutral` #c5edab 徽章（P4 §5）vs warning 底 ink 字（P5b §5） | P1·P4·P5b（对 P3/P3c） | 统一 **warning 族**：状态点 = `warning` #ffd11a；徽章 = 底 `warning` #ffd11a + 字 `warning-content` #4a3b1c。P1 统计行 developing 点 ink→`warning`；P4 §5 developing 徽章 `primary-neutral`→warning 族（`primary-neutral` 让给 create/created 类型徽章专用，避免撞色）；P5b developing 徽章字 ink→`warning-content` |
| 12 | **红线违规：P5 看板 in_progress 列点用品牌绿 `primary` #9fe870 表示「进行中」状态**（自辩「品牌强调非成功语义」，但 P1 红线为「绿绝不表示任何状态」）；P4 任务行 in_progress 点为 ink | P5（对 P4） | 统一 **in_progress 状态点 = `ink` #0e0f0c**（P4 方案；中性深色=活跃进行，P1 统计行先例）。P5 §5 in_progress 行与 §6 差异要点第 2 条相应改；品牌绿状态位清零 |
| 13 | **needs_reassessment 待重估徽章三种**：`warning` 底 + `warning-content` 字（P1/P2/P4）vs `warning-deep` 底白字（P3c §5）vs `warning` 底 ink 字（P5b，同病：临期徽章、developing 徽章字均用 ink） | P3c·P5b（对 P1/P2/P4） | 统一 **底 `warning` #ffd11a + 字 `warning-content` #4a3b1c**（规范定义的 warning 面文字色；凡 warning 底徽章一律此字色，含 P5b 临期徽章）。P3c §5 待重估行、P5b 临期/待重估行改。**状态点区分**：developing 点 = `warning` #ffd11a、needs_reassessment 点 = `warning-deep` #b86700（P1 统计行待重估点改 `warning-deep`，避免与 developing 点同色） |
| 14 | 超期行内弱呈现文字 token 误用：P3c deadline 行、P5 超期文字用 `negative-deep` #a72027（规范语义=按压态）；P1 用 `negative-darkest` #a7000d（规范语义=最高强调破坏性文字） | P3c·P5（对 P1） | 统一 **行内超期文字 = `negative-darkest` #a7000d · 600**。P3c §5 超期行、P5 §5 超期行 token 改。徽章形态（强场景）仍为 `badge-negative`（见 #15） |
| 15 | **negative 实色 #d03238 被用作徽章底**：P3c「未裁决」「分析失败」徽章、P5b 超期/临期外徽章、分析失败徽章均为 `negative` 实底白字；P1/P2/P3/P5 为规范 `badge-negative`（`negative-bg` #320707 底） | P3c·P5b | 统一 **一切 negative 徽章 = `badge-negative`（底 `negative-bg` #320707 + 白字，pill）**；`negative` 实色只作图标、hover、状态点与文字色，**不做徽章底**。P3c §5 未裁决/分析失败行、P5b §5 超期/分析失败行改 |
| 16 | draft 呈现细节分歧：P3 状态点为空心圆环 vs P1 实心 `mute` 点；P5b 徽章字 `mute` vs P2/P3/P3c 字 `body`；P4 头部 draft 徽章白底（坐 sage 场景） | P3·P5b·P4 | 统一：**状态点 = `mute` #868685 实心 8px**（P3 空心改实心）；**徽章 = 底 `canvas-soft` + 字 `body`**（P5b 字改 body）；徽章直接坐在 sage 底上时允许表面对比翻转为白底 `canvas` + `body` 字（P4 变体合法） |
| 17 | **actor 徽章两种体系**：双态（human=`canvas-soft`+`body`；ai:*/mcp:*=ink 反白；P2/P3/P3c/P4 四页）vs P5 三表面（human 灰底 ink 字、ai:analysis=`primary-pale` 淡绿底、mcp=白底描边） | P5（对 P2/P3/P3c/P4） | 统一 **双态**：human = 底 `canvas-soft` + 字 `body`；`ai:*` / `mcp:*` = 底 `ink` + 字 `canvas-soft`。P5 §3.4 三表面废除（ai 用 `primary-pale` 淡绿底有误读为正向状态的风险）；看板页如需强化区分可保留前缀图标（人形/✦/终端），但表面色回归双态；P5 human 字 ink→body |
| 18 | **红线违规：P6 图表引入 `accent-cyan` #38c8ff 作数据分段，并以 `primary` 品牌绿作「AI 产出」「任务」分段**——cyan 规范定位为插画三级 accent，进产品图表即第二强调色；且与 P5b 图表色板（positive/warning/ink/mute）不同族 | P6 | 统一 **全站数据可视化分段色板 = `ink` / `positive` #2ead4b / `warning` #ffd11a / `mute`**（与 P5b 需求点分布条同族）。P6 操作者分布：human=`ink`、ai:analysis=`positive`、mcp=`mute`；实体分布：需求点=`ink`、任务=`positive`、素材=`warning`、分组/项目=`mute`；`accent-cyan` 删除；图表分段不再使用品牌绿 #9fe870 |
| 19 | P6 时间线事件行（高 56px 列表行）用 `rounded.xl` 24px 圆角；其他页行级容器为 12px（P4 任务行/P3c 参照行/P5b 清单行） | P6 | 统一圆角三级：**行级容器 = `rounded.md` 12px；卡内块级子卡 = `rounded.lg` 16px（P5b 需求行、P7 代码块合法）；页面浮卡/按钮 = `rounded.xl` 24px**。P6 事件行 24→12 |
| 20 | P7「推荐」徽章字色用 `ink-deep` #163300，与全站 `primary-pale` 底徽章字 `positive-deep` #054d28 不同（同底双色，落盘易混） | P7 | 统一 **`primary-pale` 底徽章字一律 `positive-deep` #054d28**（badge-positive 同款配色）。P7 推荐徽章字改 `positive-deep`；`ink-deep` 保留给大面 positive 表面（`card-feature-green`）正文文字，不用于徽章 |
| 21 | **进度条填充语义冲突**：同为「完成进度」语义，P1 §3.2 行⑤ 项目卡进度条填充 `ink` #0e0f0c（自称「数据可视化中性色，不是成功语义」），P2 §3.3 模块进度条与 P5b §3.2 需求行进度条填充 `positive` #2ead4b（「进度=正向进展」） | P1（对 P2·P5b） | 统一 **进度/完成度条填充 = `positive` #2ead4b**（轨道 `canvas-soft`、pill 圆角不变）。P1 §3.2 行⑤ 填充 ink→`positive`，P1 §6 差异要点第 4 条「进度条蓝条改 ink 近黑」表述以本裁定为准；P3c 置信度条为诊断型分档条（positive/warning/negative 按值），不属此列 |

## 2. 红线检查结论（四项）

| 红线 | 结论 |
|---|---|
| #9fe870 绿当成功色 | **未发现**。done/成功/复制成功态各页均落 positive 族（P7 复制成功态 positive-deep ✓）。但 P5 把绿当「进行中」状态色（问题 #12）、P5b/P6 绿底头像与 P6 绿分段（问题 #4/#18）属绿出现位膨胀，已裁定收敛。收敛后绿色仅允许出现于：页面级 CTA、Tab/侧栏激活指示条、P3c 勾选选中态、合并条深底上的绿 CTA（规范 `card-feature-dark` 用法） |
| 引入第二强调色 | **P6 `accent-cyan` 图表分段违规**（问题 #18），裁定删除。其余页无蓝/紫/青 |
| 锐角按钮 | **未发现**。全部按钮 24px（嵌框缩小版 12px 合法）。P6 Tab 指示条 2px 圆角随问题 #7 一并 pill 化 |
| success 未用 positive 族 | **通过**。全部成功语义（done/confirmed/active/已分析/已复制/已应用）均为 `badge-positive` / positive 族；developing/待重估/临期 = warning 族；超期/失败/相悖 = negative 族（#10–#15 裁定后全站成立） |

## 3. 确认一致项（无需处理）

- 字体家族：九页均统一 Noto Sans SC 三档 900/600/400，无 500/700 等杂档；P7 代码用等宽字体且限 ASCII，符合其声明豁免。
- 页面底色：九页均为 `canvas-soft` #e8ebe6 + 白卡表面对比，TopBar 白底无边框。
- 卡片：白底 24px 圆角、无边框无阴影（Level 2 Soft Card）全站一致；`button-primary/secondary/tertiary` 用法与规范一致。
- 变更历史/动态类型四分色同族：P2 动态类型与 P4 类型 pill 映射一致（中性灰 / `badge-positive` confirm·revision / `primary-neutral` create·created / warning linkage_impact）；P6 时间线「语义收敛到类型点」的降噪策略允许，但类型语义须同族（confirm=positive、linkage_impact=warning 族，P6 已满足）。
- `badge-negative` 规范内部矛盾说明：`wise/DESIGN.md` YAML 中 `badge-negative.textColor` 指向 `{colors.on-primary}`（#0e0f0c），正文写 white；深栗底上黑字不可读，九页规格亦全部写白字——**落盘按白字 #ffffff 执行**。
- 允许的页面级差异（不视为不一致）：P2 独有的项目描述行与 agent 提示；P3c 底部合并条 ink 深底 + 绿 CTA；P6 过滤 pill 的 ink 激活态；P3c 置信度条按值分档（诊断型进度条，区别于进度语义条，见 #21）；P1 侧栏（项目列表页无项目上下文条）与 P7 设置页（无 Tab，面包屑承担上下文）的骨架差异；needs_reassessment 警示标记形态按容器区分（P4 列表行左缘 4px 竖条 / P5 看板卡顶 6px 顶条，同 `warning` 族）。
