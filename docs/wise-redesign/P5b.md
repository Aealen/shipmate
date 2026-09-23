# P5b 进度总览 · Wise 重设计规格

> 画板 1920×1080。现状截图 `.pen-export/wise-input/PfiNC.png`；区块结构以截图为准，模块筛选行与超期/临期清单区块按功能要点补齐（对应实现 `packages/web/src/components/progress/progress-view.tsx`）。信息架构与文案全部不变，只换 Wise 视觉。全部颜色引用 `wise/DESIGN.md` token 并附 hex。

---

## 1 布局骨架

1920×1080，纵向结构（y 自上而下）：

| 区块 | y 范围 | 高度 | 说明 |
|---|---|---|---|
| TopBar | 0–60 | 60px | 全局白底导航（面包屑 + 头像） |
| 项目上下文条 | 60–132 | 72px | 标题行（约 44px）+ Tab 行（约 44px），白底 |
| 内容区（可滚动） | 156 起 | 自适应 | 左右内距 24px，页面底色 canvas-soft `#e8ebe6` |

内容区自上而下（区块间垂直间距 16px）：

1. **模块筛选行**：高 40px，右对齐，下拉框宽 200px（默认"全部模块"）
2. **KPI 统计卡行**：5 卡等宽栅格（5 列，间距 16px），卡高约 96px
3. **主体两栏**：总宽 1872（1920−48）；左栏"需求进度明细"自适应（约 1536px），间距 16px，右栏"需求点状态分布"固定 320px
4. **超期 / 临期清单**：两栏等宽（各约 928px，间距 16px），卡高自适应（约 200px）
5. **近 14 天完成任务趋势**：通栏白卡，高约 220px

---

## 2 全局元素规格

### 2.1 TopBar
- 背景 canvas `#ffffff`，无阴影；下缘与上下文条同为白色连成一体，靠内容区 sage 底形成分界
- 左：ShipMate logo（图标 + 字标），文字 ink `#0e0f0c`，"Noto Sans SC" 900、20px（品牌字标走显示层 900 档）
- 中左：面包屑「Maxon 实验室 / ShipMate / 进度」，"Noto Sans SC" 400、14px、body `#454745`，分隔符 mute `#868685`，当前段「进度」ink `#0e0f0c` 400
- 右：头像 36px 圆形（rounded.full），底 primary `#9fe870`，字 ink `#0e0f0c`、"Noto Sans SC" 600、14px（替换现状蓝色头像）

### 2.2 项目上下文条
- 背景 canvas `#ffffff`，水平内距 24px
- 标题行：左侧「ShipMate」项目名，"Noto Sans SC" 900、28px、行高 36px、ink `#0e0f0c`；右侧「active」徽章：pill 圆角（rounded.pill），底 primary-pale `#e2f6d5`，字 positive-deep `#054d28`、"Noto Sans SC" 600、12px，内距 4px 12px（即规范 badge-positive）；再右「项目概览 ›」链接：ink `#0e0f0c`、"Noto Sans SC" 600、14px
- Tab 行：5 个 Tab 等距分布（概览 / 需求分析 / 进度 / 任务看板 / 审计）
  - 激活「进度」：文字 ink `#0e0f0c`、"Noto Sans SC" 600、14px；文字下方 2px 处一条 3px 高指示条，宽与文字等宽，色 primary `#9fe870`，两端圆角 pill（品牌强调，允许用绿）
  - 非激活：文字 body `#454745`、"Noto Sans SC" 400、14px；hover 时变 ink `#0e0f0c`
  - Tab 高 44px，文字水平居中；Tab 行与标题行之间以 8px 间距分隔，不画分隔线

### 2.3 模块筛选行（内容区第一行）
- 容器：透明（直接坐在 sage 底上），右对齐，高 40px
- label「模块」："Noto Sans SC" 400、12px、mute `#868685`，与下拉框间距 8px
- 下拉框（默认值「全部模块」，另含各模块名 +「未归类」）：即规范 `text-input`——底 canvas `#ffffff`，1px 描边 ink `#0e0f0c`，圆角 rounded.md 12px，高 40px，内距 8px 12px，文字 "Noto Sans SC" 400、14px、ink `#0e0f0c`；focus 时描边保持 ink 不变色，无发光

---

## 3 逐区域详细规格

### 3.1 KPI 统计卡行（5 张）

每张卡 = 规范 `card-content`：底 canvas `#ffffff`，圆角 rounded.xl 24px，无描边无阴影（靠与 sage 底的表面对比成卡），内距 24px。

结构（纵向，间距 4px）：
- **数值**："Noto Sans SC" 900、32px、行高 36px、ink `#0e0f0c`。文字如「2/4」「6/11」「30/37」「1」「5」
- **标签**："Noto Sans SC" 400、14px、行高 20px、body `#454745`。文案依截图：需求完成 / 任务完成 55% / 需求点完成 / 已超期 / 本周完成任务

语义色例外：仅「已超期」卡的数值 1 用 negative `#d03238`；其余四卡数值一律 ink `#0e0f0c`（移除现状蓝/绿彩色数字）。

> 备注：当前代码实现为 4 卡版（需求完成 / 已超期 / 需求点完成+% / 临期，见 `progress-view.tsx:136-148`）。若最终以代码为准，按本节卡片样式类推替换卡数与文案即可，样式不变。

### 3.2 需求进度明细（左栏白卡）

容器 = `card-content`：底 canvas `#ffffff`，圆角 24px，内距 24px。

**卡头**（高 32px，下距 16px）：
- 标题「需求进度明细」："Noto Sans SC" 600、20px、行高 28px、ink `#0e0f0c`
- 右侧工具标识「get_project_progress」："Noto Sans SC" 400、12px、mute `#868685`

**需求行**（每行一个子卡，纵向堆叠，行间距 12px）：
- 行容器：底 canvas-soft `#e8ebe6`（白卡内的 sage 面，形成二级层次），圆角 rounded.lg 16px，内距 16px 20px，行内三段纵向排列：
  1. **标题行**（高 24px）：
     - 优先级徽章：pill 圆角，高 20px，内距 2px 8px，"Noto Sans SC" 600、12px。P0/P1：底 negative `#d03238`、字 `#ffffff`；P2：底 canvas `#ffffff`（与 sage 行底形成对比）、字 body `#454745`；P3：底 canvas `#ffffff`、字 mute `#868685`。徽章与标题间距 8px
     - 需求标题：「素材分析与需求提炼」「MCP 工具面」「数据模型与变更链」「Web 界面」："Noto Sans SC" 600、16px、ink `#0e0f0c`，超长截断加省略号
     - 行最右：「3/4 任务」计数，"Noto Sans SC" 400、14px、body `#454745`，数字 tabular-nums
  2. **进度条**（标题行下 10px）：高 6px，圆角 rounded.pill；轨道白色 `#ffffff`（在 sage 行底上可见）；填充按行完成比例，色 positive `#2ead4b`（统一语义绿，替换现状绿/蓝混用）
  3. **日期行**（进度条下 6px）："Noto Sans SC" 400、12px、行高 16px：
     - 普通日期「10-15」「10-30」：mute `#868685`
     - 超期「09-05 已超期」：negative `#d03238`、"Noto Sans SC" 600
     - 临期「09-30 · 剩 19 天」：warning-deep `#b86700`、"Noto Sans SC" 600
- 每行总高约 90px（24+10+6+6+16 + 上下内距 32）

### 3.3 需求点状态分布（右栏白卡，宽 320px）

容器 = `card-content`：底 canvas `#ffffff`，圆角 24px，内距 24px。

- 标题「需求点状态分布」："Noto Sans SC" 600、20px、行高 28px、ink `#0e0f0c`，下距 16px
- **堆叠比例条**：高 12px，圆角 rounded.pill，条内段间距 2px（露出白底缝隙）。按 done 30 / developing 9 / confirmed 6 / draft 12 比例分段，段色（左→右）：
  - done：positive `#2ead4b`
  - developing：warning `#ffd11a`
  - confirmed：ink `#0e0f0c`
  - draft：mute `#868685`
- **图例**（条下 12px）：4 行纵向，行距 8px；每行 = 8px 圆点（色同上）+ 状态名 "Noto Sans SC" 400、14px、body `#454745` + 数字 "Noto Sans SC" 400、12px、mute `#868685`（tabular-nums）。文案：done 已完成 30 / developing 开发中 9 / confirmed 已确认 6 / draft 草稿 12
- **提示框**（图例下 16px）：底 primary-pale `#e2f6d5`（规范 card-feature-green 表面，非成功状态色），圆角 rounded.md 12px，内距 12px 16px，文案「draft 12 个待确认 — 素材 Tab 可继续分析产出，或逐条确认」："Noto Sans SC" 400、14px、行高 20px、ink `#0e0f0c`，其中「draft 12 个待确认」600 加重
- 空态（该模块无需求点时）：仅标题 + 一行 "Noto Sans SC" 400、12px、mute `#868685` 文案「暂无需求点」

### 3.4 超期 / 临期清单（两栏白卡）

两卡均 = `card-content`：底 canvas `#ffffff`，圆角 24px，内距 24px。

**卡头**（高 24px，下距 12px）：
- 状态圆点 8px：超期卡 negative `#d03238`、临期卡 warning `#ffd11a`
- 标题「超期需求」/「临近到期」："Noto Sans SC" 600、16px、ink `#0e0f0c`；标题后计数 "Noto Sans SC" 400、12px、mute `#868685`

**列表项**（行间距 8px）：
- 行容器：底 canvas-soft `#e8ebe6`，圆角 rounded.md 12px，内距 8px 12px，高 40px，横向排列：
  - 需求标题："Noto Sans SC" 400、14px、ink `#0e0f0c`，截断省略
  - 到期日「09-05」："Noto Sans SC" 400、12px、mute `#868685`，tabular-nums
  - 行尾徽章（pill 圆角，高 20px，内距 2px 8px，"Noto Sans SC" 600、12px）：
    - 超期徽章「超期 N 天」：底 negative `#d03238`、字 `#ffffff`
    - 临期徽章「临期」：底 warning `#ffd11a`、字 ink `#0e0f0c`
- 空态：一行 "Noto Sans SC" 400、12px、mute `#868685`「无超期需求」/「无临近到期需求」，不画行

### 3.5 近 14 天完成任务趋势（通栏白卡）

容器 = `card-content`：底 canvas `#ffffff`，圆角 24px，内距 24px，总高约 220px。

- 卡头（高 28px，下距 16px）：标题「近 14 天完成任务趋势」"Noto Sans SC" 600、20px、ink `#0e0f0c`；最右「合计 23 · 日均 1.6」"Noto Sans SC" 400、12px、mute `#868685`
- **图表区**（高 140px）：14 根柱横向均分（flex space-between），柱宽 24px：
  - 有值柱：positive `#2ead4b`（与进度条同一「完成」语义），圆角 rounded.pill（上下全圆），高度按值线性缩放（最大值柱撑满 140px）
  - 零值柱：画 4px 高圆点，底 canvas-soft `#e8ebe6`
  - 柱顶数值「1」「4」「5」等："Noto Sans SC" 400、12px、mute `#868685`，位于柱顶上方 4px
- **横轴标签**：图表区下 8px，「1日」…「14日」，"Noto Sans SC" 400、12px、mute `#868685`，与柱纵向居中对齐

---

## 4 组件映射表

| 页面元素 | Wise 组件 / token | 关键参数 |
|---|---|---|
| KPI 统计卡 / 明细卡 / 分布卡 / 清单卡 / 趋势卡 | `card-content` | canvas `#ffffff`、rounded.xl 24px、padding 24px、无边框无阴影 |
| 白卡内需求行 / 清单行 | `card-feature-sage`（降级为行容器） | canvas-soft `#e8ebe6`、rounded.lg 16px（行）/ rounded.md 12px（清单行） |
| 模块筛选下拉 | `text-input` | 白底、1px ink `#0e0f0c` 描边、rounded.md 12px、高 40px |
| Tab 激活指示条 | 品牌强调（允许用 primary） | primary `#9fe870`、3px 高、pill 圆角 |
| 「active」徽章 | `badge-positive` | primary-pale `#e2f6d5` 底 + positive-deep `#054d28` 字、pill |
| P0/P1 优先级徽章 | 负向 pill（badge-negative 族） | negative `#d03238` 底 + `#ffffff` 字、pill、12px/600 |
| P2/P3 优先级徽章 | 中性 pill | `#ffffff` 底 + body `#454745` / mute `#868685` 字、pill |
| 任务完成进度条 | 自绘数据条 | 轨道 `#ffffff`、填充 positive `#2ead4b`、高 6px、rounded.pill |
| 需求点分布堆叠条 | 自绘分段条 | positive `#2ead4b` / warning `#ffd11a` / ink `#0e0f0c` / mute `#868685`、高 12px、rounded.pill |
| 超期徽章 | 负向 pill | negative `#d03238` 底 + `#ffffff` 字 |
| 临期徽章 | 警示 pill | warning `#ffd11a` 底 + ink `#0e0f0c` 字 |
| 趋势柱 | 自绘柱状 | positive `#2ead4b`、宽 24px、rounded.pill |
| 头像 | `button-icon-circular` 变体 | primary `#9fe870` 底、rounded.full 36px |
| 「项目概览 ›」链接 | `nav-link` | ink `#0e0f0c`、"Noto Sans SC" 600、14px |

---

## 5 状态与语义色

| 业务状态 | 语义 | 图表/进度色 | 徽章样式（pill，12px/600，内距 2px 8px） |
|---|---|---|---|
| done 已完成 | 成功 | positive `#2ead4b` | primary-pale `#e2f6d5` 底 + positive-deep `#054d28` 字（badge-positive） |
| developing 开发中 | 进行 | warning `#ffd11a` | warning `#ffd11a` 底 + ink `#0e0f0c` 字 |
| confirmed 已确认 | 中性确定 | ink `#0e0f0c` | canvas-soft `#e8ebe6` 底 + ink `#0e0f0c` 字 |
| draft 草稿 | 待办 | mute `#868685` | canvas-soft `#e8ebe6` 底 + mute `#868685` 字 |
| 超期 overdue | 危险 | — | negative `#d03238` 底 + `#ffffff` 字；日期文字 negative `#d03238` 600 |
| 临期 dueSoon | 警示 | — | warning `#ffd11a` 底 + ink `#0e0f0c` 字；日期文字 warning-deep `#b86700` 600 |
| 优先级 P0/P1 | 高优 | — | negative `#d03238` 底 + `#ffffff` 字 |
| 需求状态 done（需求行 StatusBadge） | 成功 | — | 同 done 徽章 |
| 需求状态 needs_reassessment 待重估 | 警示 | — | warning `#ffd11a` 底 + ink 字（本页通常不出现，样式预留） |
| 分析失败 / 错误 | 危险 | — | negative `#d03238` 底 + `#ffffff` 字；深底变体 negative-bg `#320707` + `#ffffff`（仅整块 callout 用） |

红线自查：Wise 绿 `#9fe870` 只出现在 Tab 激活指示条、头像、「active」徽章浅底（badge-positive 组件）与提示框浅底（card-feature-green 表面）；所有「完成/成功」语义一律 positive `#2ead4b`。全页无第二强调色（现状蓝系全部移除）。

---

## 6 与现状差异要点

1. **页面换底**：整页白底改为 sage canvas `#e8ebe6` 鼠尾草底，TopBar/上下文条保持白色；全部内容装进白色 24px 圆角卡（`card-content`），删除现有卡片阴影与描边，层次全靠白卡对 sage 底的表面对比。
2. **蓝色系清零**：现状的第二强调色蓝（KPI「6/11」「30/37」彩字、P2 徽章蓝、confirmed 蓝点、两条蓝色进度条、14 天蓝色柱状图、蓝色提示框、蓝色头像）全部移除——数值统一 ink `#0e0f0c`，confirmed 改 ink 墨色，趋势柱与提示框重新指定语义/表面色，头像改品牌绿底。
3. **绿色分工重划**：现状把亮绿既当 CTA 又当进度条；Wise 化后品牌绿 `#9fe870` 仅保留 Tab 激活条与头像，任务完成进度条、趋势柱、done 分布段统一改语义绿 positive `#2ead4b`（绿≠成功色的红线）。
4. **超期/临期语义化**：行内日期由彩色裸文字升级为「语义文字色 + pill 徽章」双表达——超期 negative `#d03238` 族、临期 warning `#ffd11a` 族；新增超期/临期双清单白卡区块（对应 `progress-view.tsx:261-324`），列表行用 sage 子行承载。
5. **补齐模块筛选行**：内容区顶部右对齐增加「模块」下拉（默认「全部模块」），样式取 `text-input`（白底 1px ink 描边 12px 圆角），替换现状无 Wise 化的原生 select 外观。
