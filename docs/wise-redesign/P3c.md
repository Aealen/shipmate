# P3c 素材分析工作台 · Wise 重设计规格

> 画板 1920×1080。规范唯一真相源：`wise/DESIGN.md`。字体全局约定：显示层大标题 Noto Sans SC 900；次级标题/导航/Tab/按钮 Noto Sans SC 600；正文 Noto Sans SC 400。信息架构、功能区、文案全部保持现状，只换视觉。
> 本页核心换血：**清除现状蓝/紫第二强调色**（勾选角标、evidences 引用 chip、补充徽章、radio 选中点、确认按钮、激活 Tab），Wise 绿 `#9fe870` 只留给页面级 CTA（开始分析 / 应用 / 合并）与品牌强调（Tab 激活指示条、块勾选选中态）；done/置信度等成功语义全部落到 positive `#2ead4b` 族，绝不复用品牌绿。

## 1 布局骨架

1920×1080 纵向结构（自上而下；工作台主体为左右双栏）：

| 区块 | 位置 (x,y) | 尺寸 (w×h) | 说明 |
|---|---|---|---|
| TopBar | (0,0) | 1920×64 | 白底通栏，无下边框（靠下方鼠尾草底对比分区） |
| 内容区 | x: 48 → 1872（宽 1824） | y: 64 → 1080 | 页面底 `{colors.canvas-soft}` #e8ebe6，左右内距 48px |
| ├ 项目名行 | (48, 88) | 1824×48 | 项目名 + active 徽章；右端「← 返回需求分析」 |
| ├ Tab 行 | (48, 152) | 1824×48 | 五 Tab 左对齐、间距 32px，激活「需求分析」 |
| ├ 工作台区 | (48, 224) | 1824×832 | 底边到 1056（距画布底留 24px）；左右栏各自独立滚动 |
| │ ├ 左栏·素材面板 | (48, 224) | 480×832 | 标题行 + 素材列表卡 + 新增素材卡 + 提示行 + 开始分析按钮（sticky 底部） |
| │ └ 右栏·草稿产出 | (552, 224) | 1320×832 | 标题行 + 草稿块纵向流（间距 16px）+ 底部合并条（sticky） |

- 栏间距 24px：左栏 x 48→528，右栏 x 552→1872。
- 左栏 480px 整栏为滚动容器（素材多时上下滚），「开始分析」按钮 sticky 在左栏可视底部；右栏同理，「合并条」sticky 在右栏可视底部。
- 草稿块高度随内容自适应（示意高见第 3 节），块间 16px（`{spacing.lg}`）。

## 2 全局元素规格

### TopBar（`{components.nav-bar}`，与全站各页一致）
- 背景 `{colors.canvas}` #ffffff，全宽 1920×64，无阴影无下边框。
- 左侧（x=48 起，水平居中排布，间距 24px）：
  - 品牌标：锚形图标 24×24 `{colors.ink}` #0e0f0c + 字标 "ShipMate" 20px · Noto Sans SC 900 · `{colors.ink}` #0e0f0c。
  - 面包屑 14px："Maxon 实验室" 400 `{colors.mute}` #868685 → "/" 400 `{colors.mute}` #868685 → "ShipMate" 400 `{colors.mute}` #868685 → "/" → "素材分析" 600 `{colors.body}` #454745（当前页加重一档）。
- 右侧（右缘对齐 x=1872）：用户头像 40×40 圆形 `{rounded.full}`，底 `{colors.ink}` #0e0f0c，字 "明" 14px · 600 · `{colors.canvas-soft}` #e8ebe6（与 P2 一致的 ink 反白方案，替换现状蓝色头像）。

### 项目名行（y 88，高 48）
- 项目名 "ShipMate"：40px · Noto Sans SC 900 · `{colors.ink}` #0e0f0c，行高 48px（与 P2 同规格）。右随 12px 处放 active 徽章（见第 5 节）。
- 右端（右对齐）：链接「← 返回需求分析」14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c，hover 加下划线（text-underline-offset 2px）。**无蓝色**。

### Tab 行（y 152，高 48）
- 五 Tab 左对齐、间距 32px（`{spacing.2xl}`），行高 48px，无通栏分隔线（少边框红线）。
- 激活 Tab「需求分析」：16px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c；文字底部 0px 处一条 3px 高、与文字等宽、圆角 pill 指示条 `{colors.primary}` #9fe870（品牌强调用途，依据规范 `ex-app-shell-row` 的 `activeIndicator`）。
- 非激活 Tab（概览 / 进度 / 任务看板 / 审计）：16px · Noto Sans SC 600 · `{colors.body}` #454745；hover 变 `{colors.ink}` #0e0f0c，无底色变化。

## 3 逐区域详细规格

### 3.1 左栏 · 素材面板（480 宽）

#### 3.1.1 栏标题行（y 224，高 32）
- 水平排布（间距 8px，垂直居中）：「本次素材分析」18px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c → 「· 已添加 11 条」14px · 600 · `{colors.mute}` #868685（数字与文案同色，现状粗黑整串改为层级分离）。

#### 3.1.2 素材列表卡（标题下 16px 起）
- 容器：`{components.card-content}`——背景 `{colors.canvas}` #ffffff，圆角 `{rounded.xl}` 24px，**无内距**（行自带内距），无边框无阴影（Level 0，靠鼠尾草底对比浮起）。
- 行列表示：11 行，单行高 64px，行间 1px 分隔线 `{colors.canvas-soft}` #e8ebe6（首行上方、末行下方无线，依据 `ex-data-table-cell` 的 `rowBorder`）。可视区限高约 384px（6 行），超出列表内部滚动。
- 每行结构（水平排布，垂直居中，内距 12px 16px）：
  1. 类型图标 20×20 `{colors.mute}` #868685（粘贴文本=文档线条、文档片段=文件线条、录音转写=麦克风、截图附文=相机；现状彩色文件图标统一降为 mute 单色线性图标）。
  2. 12px 间距 → 文字列（纵向）：
     - 标题（如「产品群聊记录 09-10」）14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c，行高 20px。
     - 副标（如「粘贴文本 · 2,341 字」）12px · 400 · `{colors.mute}` #868685，行高 16px，上距 2px。类型不再是徽章，保持文字副标（现状即如此，不变）。
  3. 行尾右对齐：删除按钮 = `{components.button-icon-circular}` 变体：32×32 圆形，透明底，× 图标 16px `{colors.mute}` #868685；hover 底 `{colors.canvas-soft}` #e8ebe6、图标 `{colors.negative}` #d03238（破坏动作语义色）。

#### 3.1.3 新增素材卡（列表卡下 16px 起）
- 容器：`{components.card-content}`——白 #ffffff，圆角 24px，内距 24px，无边框无阴影。示意总高约 356px。
- 纵向排布：
  1. 卡标题「新增素材」16px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c，行高 24px。
  2. 上距 16px → 类型分段选择（三段：粘贴文本 / 截图附文 / 文档片段）：
     - 槽体：背景 `{colors.canvas-soft}` #e8ebe6，圆角 `{rounded.xl}` 24px，内距 4px，高 44px，三段等宽。
     - 选中段：底 `{colors.canvas}` #ffffff，圆角 20px，文字 14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c（白 pill 在灰槽上，靠表面对比分出选中，不用蓝底）。
     - 未选段：透明底，文字 14px · 600 · `{colors.body}` #454745。
  3. 上距 16px → 来源行：「产品群聊记录 2026-09-10」12px · 400 · `{colors.mute}` #868685。
  4. 上距 8px → 内容多行输入框 = `{components.text-input}`：背景 `{colors.canvas}` #ffffff，1px solid `{colors.ink}` #0e0f0c 描边，圆角 `{rounded.md}` 12px，内距 12px 16px，文字 14px · 400 · `{colors.ink}` #0e0f0c，行高 20px，placeholder `{colors.mute}` #868685，高 128px。
  5. 上距 16px → 按钮「+ 添加到本次分析」= `{components.button-secondary}`：背景 `{colors.canvas-soft}` #e8ebe6，文字 `{colors.ink}` #0e0f0c，16px · Noto Sans SC 600（`{typography.button-md}`），全宽、高 48px，圆角 `{rounded.xl}` 24px。

#### 3.1.4 提示行（新增卡下 12px）
- 「分析完成后产出需求草稿(draft)，回到需求分析列表确认，原文档页只开核对」12px · 400 · `{colors.mute}` #868685，行高 16px，可两行。

#### 3.1.5 开始分析按钮（sticky 左栏可视底部，上距 12px）
- = `{components.button-primary}`（本栏唯一绿色 CTA）：背景 `{colors.primary}` #9fe870，文字 `{colors.on-primary}` #0e0f0c，16px · Noto Sans SC 600，全宽 480×56px（大 CTA 加高一档），圆角 `{rounded.xl}` 24px，无边框；前置 ✦ 图标 16px 同 `{colors.on-primary}` #0e0f0c。文案「开始分析 · 11 条素材」。hover 底 `{colors.primary-active}` #cdffad。
- **替换现状蓝底白字锐角按钮；绿底上绝不允许再出现白色文字（on-primary 只有黑）**。

### 3.2 右栏 · 草稿产出（1320 宽）

#### 3.2.1 标题行（y 224，高 56，水平两端对齐、垂直居中）
- 左侧纵向：
  - 「分析产出」24px · Noto Sans SC 900 · `{colors.ink}` #0e0f0c（本页显示层大标题，行高 32px）。
  - 上距 4px → 说明「素材:产品群聊记录 09-10 · actor: ai:analysis · 勾选所需需求(可增删)，「应用」后追加至需求列表」12px · 400 · `{colors.mute}` #868685。
- 右侧水平排布（间距 12px，垂直居中）：
  - 徽章「草稿: 未应用」：pill，高 24px（内距 2px 12px），12px · 600 · 底 `{colors.canvas-soft}` #e8ebe6、字 `{colors.body}` #454745（中性待办；应用后翻转见第 5 节）。
  - 按钮「应用」= `{components.button-primary}`：背景 `{colors.primary}` #9fe870，文字 `{colors.on-primary}` #0e0f0c，16px · Noto Sans SC 600，高 48px、内距 12px 24px，圆角 24px。本页唯二绿色 CTA 之一。

#### 3.2.2 草稿块通用骨架（四类块共用）
- 容器：`{components.card-content}`——白 #ffffff，圆角 `{rounded.xl}` 24px，内距 24px，无边框无阴影。块宽 1320。
- **勾选角标 Wise 化**：弃用现状左上三角旗（锐角与品牌语言冲突），改为标题行最左的圆形勾选钮 28×28（`{rounded.full}`）：
  - 未勾选：透明底 + 1.5px solid `{colors.ink}` #0e0f0c 圆环。
  - 勾选：底 `{colors.primary}` #9fe870 + ✓ 描边图标 16px `{colors.on-primary}` #0e0f0c，无描边（勾选=选择态品牌强调，依据 `ex-app-shell-row` activeIndicator 用绿逻辑；非成功语义）。
- 块头行（水平两端对齐）：勾选钮 + 12px + 块标题（见各块）+ 12px + 信息徽章（见各块）；右端统计文字与关闭钮。
- 块内行间分隔：1px `{colors.canvas-soft}` #e8ebe6。
- 块底通用「+ 添加需求点」：全宽高 44px，`{components.button-secondary}`（底 `{colors.canvas-soft}` #e8ebe6、字 `{colors.ink}` #0e0f0c、14px · 600、圆角 24px）。弃用现状灰底方角条。

#### 3.2.3 需求块（草稿块，示意高约 380px）
- 块头：勾选钮 + 「需求:投标文件导出与格式规范化」16px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c；右端「3 个需求点」12px · 400 · `{colors.mute}` #868685 + 关闭钮（32×32 圆形透明底 ×，hover 底 `{colors.canvas-soft}` #e8ebe6）。
- 块头下 8px → deadline 行：「⧗ deadline 2026-10-01」12px · 400 · `{colors.body}` #454745，日历图标 14px `{colors.mute}` #868685；超期时整行 600 · `{colors.negative-deep}` #a72027 并追加「· 超期 3 天」（见第 5 节）。
- 需求点行（行内距 16px 0，行间 1px `{colors.canvas-soft}` #e8ebe6；单行示意高约 112px）——水平两端对齐：
  - 左列（纵向）：
    1. 行 1：状态徽章 `draft`（第 5 节样式，pill 高 24px，12px · 600）+ 8px + 需求点标题（「一键导出 PDF」）14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c。
    2. 上距 4px → 描述 12px · 400 · `{colors.body}` #454745，行高 16px，最多两行。
    3. 上距 8px → 置信度行（水平排布，间距 8px，垂直居中）：「置信度」12px · 400 · `{colors.mute}` #868685 → 进度条宽 120×高 6px、圆角 `{rounded.pill}`（底槽 `{colors.canvas-soft}` #e8ebe6；填充色按值分档，见第 5 节；0.92 填 `{colors.positive}` #2ead4b、0.78 填 `{colors.warning}` #ffd11a）→ 数值「0.92」12px · 400 · `{colors.body}` #454745。
  - 右列（纵向，右对齐，间距 8px）：
    1. evidences 引用 chip：「原文依据 ×1」pill 高 24px（内距 2px 12px），底 `{colors.canvas-soft}` #e8ebe6、字 12px · 400 · `{colors.body}` #454745 + 引用图标 12px 同色；hover 字变 `{colors.ink}` #0e0f0c。**弃用现状蓝色 chip**。
    2. 操作组（水平，间距 8px）：「确认」= `{components.button-secondary}`（底 `{colors.canvas-soft}` #e8ebe6、字 `{colors.ink}` #0e0f0c、14px · 600、高 36px、圆角 24px）——**弃用现状绿底白字小按钮**（行级操作不占用品牌绿，绿色只留给页面级 CTA）；「编辑」= 文字按钮 14px · 600 · `{colors.ink}` #0e0f0c，hover 下划线；删除 × = 32×32 圆形透明底，图标 `{colors.mute}` #868685，hover 图标 `{colors.negative}` #d03238。

#### 3.2.4 补充块（已有需求 · 本次补充，示意高约 220px）
- 块头：勾选钮 + 「需求:投标文件导出与格式规范化」600 16px ink + 12px + 信息徽章「已有需求 · 本次补充」：pill 高 24px，透明底 + 1px solid `{colors.ink}` #0e0f0c 描边、字 12px · 600 · `{colors.ink}` #0e0f0c（中性信息型，**弃用现状蓝底**）。
- 右端：「已有 2 点 + 新增 1 点」12px · 400 · `{colors.mute}` #868685（无关闭钮，勾选即采纳）。
- 说明行（块头下 8px）：「应对时校追加补充点，已有需求点保持原状态」12px · 400 · `{colors.body}` #454745。
- 需求点行（行内距 12px 0）：
  1. 行 1：状态徽章 `done`（第 5 节 badge-positive 样式）+ 「一键导出 PDF」600 14px ink；右端「4 任务 · 已完成 · 实时状态」12px · 400 · `{colors.mute}` #868685（已有点只读展示，无操作钮）。
  2. 行 2：状态徽章 `draft` + 「页眉页脚配置」600 14px ink + 8px + 「补充」小徽章：pill 高 20px（内距 1px 8px），底 `{colors.canvas-soft}` #e8ebe6、字 12px · 600 · `{colors.ink}` #0e0f0c（**弃用现状紫/蓝**）；右端「0.78」12px · 400 · mute + 删除 ×（32 圆形，hover negative）。

#### 3.2.5 重复块（重叠裁决，示意高约 240px）
- 块头：⚠ 图标 16px `{colors.warning-deep}` #b86700 + 「页眉页脚配置」600 16px ink + 12px + 徽章「与已有需求重叠」：pill 高 24px，底 `{colors.warning}` #ffd11a、字 12px · 600 · `{colors.warning-content}` #4a3b1c（warning 族，**弃用现状橙黄描边**）。
- 右端：「源自 群聊 09-10」12px · 400 · `{colors.mute}` #868685。
- 裁决 radio 组（块头下 16px，水平排布，间距 12px）：素材并入已有需求（选中）/ 优先新建 / 跳过。
  - 选中项：整体为 pill 底 `{colors.canvas-soft}` #e8ebe6（内距 8px 16px，圆角 `{rounded.pill}`），内部：radio 圆 20px（白 #ffffff 底 + 1.5px solid `{colors.ink}` #0e0f0c 环 + 内实心点 10px `{colors.ink}` #0e0f0c）+ 文字 14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c。**选中点用 ink 不用蓝**。
  - 未选项：透明底，radio 圆白底 + 1.5px solid `{colors.mute}` #868685 环，文字 14px · 400 · `{colors.body}` #454745。
- 说明行（上距 12px）：「并入 → 本次素材 evidences 追加至已有需求点「页眉页脚配置」，不产生新需求点」12px · 400 · `{colors.body}` #454745。
- 已有需求参照行（上距 12px）：整行底 `{colors.canvas-soft}` #e8ebe6、圆角 `{rounded.md}` 12px、内距 12px 16px、高 48px——`draft` 徽章 + 「页眉页脚配置」14px · 600 · ink；右端「对比详情 ›」12px · 600 · `{colors.ink}` #0e0f0c 链接（**弃用现状蓝色**）。

#### 3.2.6 相悖块（强制裁决，示意高约 260px）
- 块头：⟲ 图标 16px `{colors.negative}` #d03238 + 「移除 PDF 导出，仅保留 Word」600 16px ink + 12px + 徽章「与「一键导出 PDF」相悖」= `{components.badge-negative}`：底 `{colors.negative-bg}` #320707、字 12px · 600 · #ffffff、pill 高 24px。
- 右端：状态徽章「未裁决」（第 5 节 negative 样式）。
- 裁决 radio 组（块头下 16px）：用新 · 旧需求转入待重估（选中）/ 用旧 · 舍弃此条 / 都保留。样式同 3.2.5 radio 规范。
- 强制警示条（上距 12px）：整行底 `{colors.negative-bg}` #320707、圆角 `{rounded.md}` 12px、内距 8px 16px、高 32px：⚠ 图标 14px #ffffff + 「相悖必须人工裁决，未裁决时该块不可应用」12px · Noto Sans SC 600 · #ffffff。**弃用现状红字裸文案，升级为深色警示条**。
- 已有需求参照行（上距 12px）：同 3.2.5 参照行容器——状态徽章 `confirmed` + 「4 任务」12px · 400 · mute + 「一键导出 PDF」600 14px ink；右端「对比详情 ›」ink 链接。

#### 3.2.7 新增需求按钮（块流末尾，全宽 1320×48）
- = `{components.button-tertiary}`：背景 `{colors.canvas}` #ffffff，1px solid `{colors.ink}` #0e0f0c 描边，文字「+ 新增需求」14px · Noto Sans SC 600 · `{colors.ink}` #0e0f0c，圆角 `{rounded.xl}` 24px。弃用现状虚线框。

#### 3.2.8 底部合并条（sticky 右栏可视底部，距底 24px，全宽 1320×64）
- = `{components.card-feature-dark}` 明暗翻转用法：背景 `{colors.ink}` #0e0f0c，圆角 `{rounded.xl}` 24px，内距 12px 24px，无边框（深底在鼠尾草画布上自带浮起）。
- 左侧：「已勾选 3 块 · 5 个需求点」14px · Noto Sans SC 600 · #ffffff；随 12px + 「勾选块将合并应用」12px · 400 · `{colors.canvas-soft}` #e8ebe6。未勾选任何块时整条文案换「勾选需要合并的草稿块」且右侧按钮禁用（禁用态：底 `{colors.canvas-soft}` #e8ebe6、字 `{colors.mute}` #868685）。
- 右侧（间距 16px）：「取消」文字按钮 14px · 600 · `{colors.canvas-soft}` #e8ebe6 + 「合并选中」= `{components.button-primary}`：底 `{colors.primary}` #9fe870、字 `{colors.on-primary}` #0e0f0c、16px · 600、高 44px、圆角 24px（深底上放绿 CTA，正是规范 card-feature-dark 的品牌瞬间用法）。

## 4 组件映射表

| 本页元素 | Wise 组件 / token | 关键参数 |
|---|---|---|
| 开始分析 / 应用 / 合并选中 | `{components.button-primary}` | 底 `{colors.primary}` #9fe870 · 字 `{colors.on-primary}` #0e0f0c · 600 16px · 圆角 24px |
| 添加到本次分析 / 确认 / 添加需求点 | `{components.button-secondary}` | 底 `{colors.canvas-soft}` #e8ebe6 · 字 ink · 600 · 圆角 24px |
| 新增需求（整行） | `{components.button-tertiary}` | 白底 + 1px ink 描边 · 圆角 24px |
| 行删除 × / 关闭 × | `{components.button-icon-circular}` 变体 | 32×32 圆 · 透明底 · hover 底 canvas-soft；破坏动作 hover 图标 negative |
| 素材列表卡 / 四类草稿块 | `{components.card-content}` | 白 #ffffff · 圆角 24px · 内距 24px · 无边框无阴影 |
| 已有需求参照行 | `{components.card-feature-sage}` 缩小版 | 底 `{colors.canvas-soft}` #e8ebe6 · 圆角 12px |
| 底部合并条 | `{components.card-feature-dark}` | 底 `{colors.ink}` #0e0f0c · 字 #ffffff / canvas-soft |
| 类型分段选择 | 自定分段控件 | 灰槽 canvas-soft + 白 pill 选中，无蓝 |
| 内容输入框 | `{components.text-input}` | 白底 · 1px ink 描边 · 圆角 12px · 内距 12px 16px |
| 状态徽章（draft/confirmed/developing/done/待重估/未裁决） | badge pill 族（done 用 `{components.badge-positive}`，未裁决/相悖用 `{components.badge-negative}`） | 见第 5 节 |
| 置信度条 | 进度条 | 轨道 canvas-soft · 填充语义色 · 高 6px · `{rounded.pill}` |
| evidences 引用 chip | 中性 pill chip | 底 canvas-soft · 字 body · pill |
| 裁决 radio | 表单 radio | ink 选中点 + canvas-soft 选中 pill 底 |

## 5 状态与语义色

统一徽章规格：pill（`{rounded.pill}`），高 24px，内距 2px 12px，文字 12px · Noto Sans SC 600。**Wise 绿 `#9fe870` 不出现在本表——它只做 CTA 与选择态，不是状态色。**

| 业务状态 | 底色 | 文字色 | 备注 |
|---|---|---|---|
| draft 草稿 | `{colors.canvas-soft}` #e8ebe6 | `{colors.body}` #454745 | 中性 |
| confirmed 已确认 | `{colors.ink}` #0e0f0c | #ffffff | ink 反白=「已定案」强中性（card-feature-dark 翻转用法），**替换现状蓝** |
| developing 进行中 | `{colors.warning}` #ffd11a | `{colors.warning-content}` #4a3b1c | warning 族 |
| done 已完成 | `{colors.primary-pale}` #e2f6d5 | `{colors.positive-deep}` #054d28 | 即规范 `{components.badge-positive}`，positive 族（非品牌绿） |
| needs_reassessment 待重估 | `{colors.warning-deep}` #b86700 | #ffffff | 深琥珀，与 developing 浅黄拉开 |
| 未裁决（相悖块头） | `{colors.negative}` #d03238 | #ffffff | negative 族 |
| 相悖标记「与…相悖」 | `{colors.negative-bg}` #320707 | #ffffff | 即 `{components.badge-negative}` |
| 分析失败 | `{colors.negative}` #d03238 | #ffffff | 行尾随「重试」button-secondary |
| 超期（块 deadline 行） | 无底 | `{colors.negative-deep}` #a72027 · 600 12px + ⚠ | 强场景（列表页）才升 badge-negative |
| 批次「草稿: 未应用」 | `{colors.canvas-soft}` #e8ebe6 | `{colors.body}` #454745 | 中性待办 |
| 批次「已应用」 | `{colors.primary-pale}` #e2f6d5 | `{colors.positive-deep}` #054d28 | badge-positive |
| active（项目状态，项目名行） | `{colors.primary-pale}` #e2f6d5 | `{colors.positive-deep}` #054d28 | badge-positive，与全站一致 |

置信度条填充分档（轨道一律 `{colors.canvas-soft}` #e8ebe6，高 6px 圆角 pill）：
- ≥ 0.80：`{colors.positive}` #2ead4b
- 0.50–0.79：`{colors.warning}` #ffd11a
- < 0.50：`{colors.negative}` #d03238

## 6 与现状差异要点

1. **画布与卡面换血**：暖白纸感底 + 浅灰描边卡 → 鼠尾草 `{colors.canvas-soft}` #e8ebe6 通底 + 纯白 24px 圆角卡（无边框无阴影），素材行分隔线、参照行全部改用 canvas-soft 表面对比。
2. **蓝色第二强调色清零**：勾选角标、evidences「原文依据」chip、补充/已有需求徽章、radio 选中点、激活 Tab、头像、返回链接——全部改为 ink/canvas-soft 中性系或品牌绿（仅勾选选中态与 Tab 指示条），全页无蓝无紫。
3. **CTA 重新集权**：开始分析、应用、合并条主按钮统一为 Wise 绿 `#9fe870` + 黑字 `#0e0f0c` + 24px 圆角；行级「确认」从绿底白字降级为 button-secondary（灰底黑字），绿色不再淹没在行操作里。
4. **状态语义归位**：done/置信度不再借用绿蓝橙混搭，改 positive/warning/negative 三族（done=positive-deep on primary-pale；confirmed=ink 反白；待重估=warning-deep），相悖强制警示升级为 `#320707` 深色警示条。
5. **形状语言柔化**：左上三角勾选旗 → 28px 圆形勾选钮（选中为品牌绿）；删除/关闭改圆形图标按钮；「+ 添加需求点」灰方角条 → 24px 圆角 secondary；底部合并条改为 ink 深色浮条 + 绿 CTA 的品牌瞬间。
