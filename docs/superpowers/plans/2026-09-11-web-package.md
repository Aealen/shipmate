# ShipMate Web 包 实施计划(Plan 3/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `@shipmate/web`——Next.js App Router 的管理界面,把 shipmate.pen 的 20 帧原型与 spec §14 交互规格落成可用 UI:项目/需求分析/进度/看板/审计 + 设置四页,明暗双主题、中英双语。

**Architecture:** Next.js 服务端直接 `import { createCore } from '@shipmate/core'`(transpilePackages 吃 TS 源,无独立 API 层);变更走 server actions + revalidate;`/api/mcp` 路由挂载 mcp 包的 streamable handler(Plan 2 产物)。UI 组件在客户端,经 server actions 调 core。

**Tech Stack:** Next.js 15(App Router)+ React 19、Tailwind CSS v4(CSS variables 双主题)、next-intl(zh-CN 默认/en)、next-themes(class 策略)、framer-motion(仅 §14 指定的复杂反馈)。

**Spec:** `docs/design.md` §14(页面交互与动效,逐条落地)、§6(数据全部经 core 服务)、§7(DomainError→提示)、§10(端口 47610)、`shipmate.pen`(20 帧视觉基准——布局/间距/配色以原型为准)。

## Global Constraints

- Node >= 22,pnpm;TS strict;web 依赖 `@shipmate/core`、`@shipmate/mcp`,禁止反向。
- `next.config.ts` 必须 `transpilePackages: ['@shipmate/core', '@shipmate/mcp']`;`serverExternalPackages: ['pg']`。
- 设计 tokens(CSS variables,light 默认 dark 覆盖,与 shipmate.pen 变量一致):

| token | light | dark |
|-------|-------|------|
| --bg | #F5F7FB | #171A21 |
| --surface | #FFFFFF | #1F2430 |
| --surface-2 | #F0F3F9 | #262C3A |
| --border | #E3E8F0 | #303748 |
| --text-primary | #1A2030 | #E8ECF4 |
| --text-secondary | #5A6478 | #9AA4B8 |
| --text-muted | #8B94A8 | #6B7488 |
| --accent | #3B6FE0 | #5B8DEF |
| --accent-dim | rgba(59,111,224,.12) | rgba(91,141,239,.16) |
| --success/--warning/--danger | #2FA36B/#E0A03B/#D9534F | #4CC38A/#E8B45A/#E5696 |
| --ai(紫)/ --draft-gray | #7C5CBF/#9AA0AC | #9B7FE8/#6B7280 |

- 状态徽章配色:draft=draft-gray、confirmed=accent、developing=warning、done=success、needs_reassessment=danger、failed=danger、pending=text-muted、archived=muted。
- 文案全部走 next-intl 翻译键(`messages/zh-CN.json` + `messages/en.json`),组件不得硬编码中文。
- 页面路由与数据源(全部经 server actions,文件 `app/actions/*.ts`):

| 路由 | 原型帧 | 数据源 |
|------|--------|--------|
| `/` | P1 | `groups.listGroups()` + `projects.listProjects()` + `projects.listProjects({groupId:null})` |
| `/project/[id]` | P2 | `projects.getProject(id)`(Tab 壳五项) |
| `/project/[id]/analysis` | P3 | `analysis.listAnalysisRuns` + `requirements.listRequirements` |
| `/project/[id]/analysis/new` | P3c/P3b/P3d/P3e | `analysis.getAnalysisRun` + `startAnalysis` + `applyAnalysisRun` |
| `/project/[id]/points/[pointId]` | P4/P4b | `points.getRequirementPoint`(详情/编辑/历史) |
| `/project/[id]/board` | P5/P5c | `tasks.listTasks({projectId})` 四列看板 |
| `/project/[id]/progress` | P5b | `projects.getProject` + `requirements.listRequirements` |
| `/project/[id]/audit` | P6 | `audit.getProjectAuditReport` |
| `/settings/mcp` | P7 | 静态配置展示 + 复制 |
| `/settings/{profile,model,system,data}` | P8 | `settings.all()/set()` + `settings.getLlmConfig()`(model 页含连接测试:调 chatJson 发最小请求) |

- 动效按 spec §14 表逐条:侧栏三态(240px→64px→0 循环,240ms cubic-bezier(0.2,0,0,1))、页面切换淡入上移 120ms、卡片 hover 边框 accent 120ms、按钮按压 scale(0.97) 80ms、看板拖拽阴影+scale(1.02)、复制"已复制 ✓"1.5s 回落、分析按钮 ✦ 旋转 + 骨架屏 + 结果 stagger 40ms、时间线新条目顶部滑入 180ms、头像下拉 120ms 淡入+4px 下移、主题切换 150ms。
- 顶栏只放头像(下拉:用户信息/深色模式/中 EN/设置/MCP 接入/退出登录占位);侧栏 ShipMate 图标是折叠开关;空状态必须有引导插图 + 主操作按钮。
- commit message 中文,**禁止任何 Co-Authored-By AI 署名**;绝不碰 `.env`。

## File Structure

```
packages/web/
├── next.config.ts          # transpilePackages + serverExternalPackages
├── package.json / tsconfig.json / postcss.config.mjs
├── src/
│   ├── app/
│   │   ├── layout.tsx      # ThemeProvider + NextIntlProvider + 侧栏/顶栏壳
│   │   ├── page.tsx        # P1
│   │   ├── api/mcp/route.ts # POST/GET → createMcpHttpHandler(db)
│   │   ├── project/[id]/{page,analysis,points/[pointId],board,progress,audit}/…
│   │   └── settings/…
│   ├── actions/{projects,analysis,points,tasks,settings}.ts   # server actions('use server')
│   ├── components/{sidebar,topbar,badge,modal,toast,empty-state,…}
│   ├── i18n/{request.ts,routing.ts} + messages/{zh-CN,en}.json
│   └── lib/{core.ts(单例 db+core),error.ts}
└── messages/
```

---

### Task 1: 脚手架与基建

**Steps:**
- [ ] 建包结构(package.json scripts dev/build/start/test;tsconfig;next.config.ts 含 transpilePackages/serverExternalPackages)
- [ ] Tailwind v4(`@import "tailwindcss"` + `@theme` 映射上表 tokens;`globals.css` 定义 `:root` light + `.dark` 覆盖)
- [ ] next-themes(class 策略,默认 light)+ next-intl(zh-CN 默认,en 预留;routing/request 配置)
- [ ] `src/lib/core.ts`:全局单例(`globalThis` 缓存)`loadDotEnv + createDatabase(SHIPMATE_DATABASE_URL) + createCore`
- [ ] `src/app/api/mcp/route.ts`:POST/GET 透传 `createMcpHttpHandler(getDb())`
- [ ] 验收:`pnpm -C packages/web build` 成功;dev 起动后首页返回 200(占位页)
- [ ] Commit:`feat(web): Next.js 脚手架、双主题 tokens 与 MCP 端点挂载`

### Task 2: 数据层(server actions + 错误映射)

**Steps:**
- [ ] `lib/error.ts`:`DomainError → { code, message }`,message 直接中文返回给 UI(toast 用)
- [ ] `app/actions/*.ts`:按路由表数据源逐个封装('use server' + revalidatePath);写操作(创建/更新/状态流转/分析/应用)全部 action 化
- [ ] 验收:临时页面调 action 取数渲染成功;Commit:`feat(web): server actions 数据层与错误映射`

### Task 3: 布局壳(侧栏三态 + 顶栏头像下拉)

**Steps:**
- [ ] Sidebar 组件:三态循环(完全展开 240px → 图标栏 64px → 隐藏 0),点击左上角 ShipMate 图标循环;宽度过渡 240ms cubic-bezier(0.2,0,0,1),图标/文字交叉淡入 150ms;展开态列分组与项目数、64px 态 hover tooltip(300ms 延迟);形态按页面记忆(localStorage)
- [ ] 顶栏:仅头像,点开下拉(120ms 淡入 + 4px 下移):用户信息、深色模式开关、中/EN 切换、设置、MCP 接入、退出登录(占位)
- [ ] 布局路由组:内容区随路由淡入 + 8px 上移 120ms
- [ ] 验收:三态切换流畅、主题/语言即时切换并持久化;Commit:`feat(web): 侧栏三态与顶栏头像下拉布局壳`

### Task 4: P1 项目首页

- [ ] 分组分区(组名 + 项目卡片栅格)+ 未分组区;卡片:名称/描述/需求完成度(getProject 摘要)/hover 边框 accent;整卡可点 → /project/[id];空状态(无项目)引导插图 + 「创建项目」按钮 + server action 建项目弹窗
- [ ] 验收:P1 帧对齐;Commit:`feat(web): P1 项目首页`

### Task 5: P2 项目 Tab 壳与概览

- [ ] `project/[id]/layout.tsx`:项目上下文条(名称 + Tab 五项:概览/需求分析/进度/任务看板/审计,当前高亮)+ 返回
- [ ] 概览页:统计卡(需求完成度/超期数/点状态分布)+ 最近变更时间线(linkage_impact 徽章微光;新条目滑入 180ms 在此页生效)
- [ ] Commit:`feat(web): P2 项目概览与 Tab 壳`

### Task 6: P3 需求分析页

- [ ] 上半:素材分析记录卡流(每卡=批次:标题/时间/素材数/草稿统计/状态徽章;「新增素材分析」→ new;点卡 → new?run=)
- [ ] 下半:需求列表(需求块:标题/优先级/计划时间/状态徽章/超期红徽「已超期 N 天」/临期黄徽;draft 置灰置顶待确认;需求点行展开;点行「详情 ›」→ P4;「📄 原文依据」→ P3b Modal)
- [ ] 验收:P3 帧对齐 + 超期/临期徽章正确;Commit:`feat(web): P3 需求分析页`

### Task 7: P3c 素材分析工作台(最重页面)

- [ ] 左栏:本次批次素材列表(类型/标题/内容摘要)+ 底部「新增素材」边框区(类型下拉/标题/内容)+ 最底「开始分析」按钮(✦ 旋转 loading;结果区骨架屏呼吸;结果卡逐条 stagger 40ms 淡入)
- [ ] 右栏:草稿需求块列表——左上角勾选角标(默认全选,点击切换);需求块可增删、块内需求点可增删改;duplicate 块打「与已有需求重复」标(默认"素材并入",可切"仍要新建");contradiction 块「⚡ 与 X 相悖」**强制裁决**(用新/用旧/都保留 三选一,未选则「应用」禁用);supplement 块带出完整已有需求(已有点实时状态 + 新点「补充」标)
- [ ] 右上「应用」→ P3d 确认弹窗「请确认,所选需求将全部追加到需求列表中」→ server action 调 applyAnalysisRun(带 decisions)→ 成功回 P3 并高亮新增
- [ ] 验收:fake 与真实模型两态均可走通(fake:临时 env 关掉模型配置时给出友好错误);Commit:`feat(web): P3c 素材分析工作台与冲突裁决`

### Task 8: 弹窗组(P3b 依据 / P3e 冲突对比)

- [ ] P3b 原文依据 Modal:需求点 evidences 列表(material 标题 + quote 原文引用块);无 evidences 标「无原文依据,需人工校验」
- [ ] P3e 冲突对比 Modal:相悖块左右对照(草稿点 vs 已有点:标题/描述/状态),裁决动作同 P3c
- [ ] Commit:`feat(web): 原文依据与冲突对比弹窗`

### Task 9: P4 需求点详情 + P4b 编辑

- [ ] 详情:面包屑(项目›需求›需求点)、状态徽章 + 流转按钮(confirm/start/complete,按压 scale(0.97))、version、溯源 evidences、关联任务列表(状态 + 重估确认入口)、变更历史时间线
- [ ] P4b 编辑弹窗:标题/描述 + **reason 必填**;提交前预览联动后果(version+1/状态回退/关联任务 N 个转待重估,调 getRequirementPoint 计算展示)
- [ ] 验收:编辑后回详情,版本/状态/历史刷新正确;Commit:`feat(web): P4 需求点详情与实质修改编辑`

### Task 10: P5 看板 + P5b 进度 + P5c 重估确认

- [ ] 看板四列:pending/in_progress/done/needs_reassessment(danger 警示顶条);任务卡拖拽换列(drag 阴影 + scale(1.02) 120ms、落位占位呼吸提示)→ set_task_status / confirm_task_reassessment;needs_reassessment 卡「确认重估」→ P5c 弹窗(展示进入重估原因——取该任务最近 status_change 日志 reason;确认后回 pending)
- [ ] 进度页:按需求聚合完成度条、点状态分布、超期/临期清单(红/黄)
- [ ] Commit:`feat(web): 任务看板、进度与重估确认`

### Task 11: P6 审计 + 设置区

- [ ] P6:筛选(实体类型/actor)+ 时间线(类型徽章/actor/原因/时间)+ 右侧统计(actor 分布/实体分布/日计数迷你柱图——纯 div 实现,禁引图表库)
- [ ] P7 MCP 接入页:stdio JSON 配置块 + HTTP 端点展示(本机 :47610/api/mcp)+ 复制按钮(点击→"已复制 ✓"→1.5s 回落)
- [ ] P8 四页:个人信息(静态占位)/模型设置(base_url/api_key/model/temperature/timeout 表单 → settings.setMany + 「测试连接」按钮调 chatJson 最小请求报成功/失败)/系统信息(版本/用例数/库连接态)/数据管理(备份/导出说明 + 危险区置灰占位)
- [ ] Commit:`feat(web): 审计页与设置区五页`

### Task 12: 动效收口、i18n 全量与构建验证

- [ ] 对照 spec §14 表逐条过一遍(缺的补,超 240ms 的调)
- [ ] zh-CN/en 键 100% 覆盖(写一个脚本比对两文件键集合,进 test)
- [ ] `pnpm -C packages/web build` 零错误;根 `pnpm lint`/`format:check` 全绿
- [ ] README(web):起动方式、端口 47610、MCP 端点
- [ ] Commit:`feat(web): 动效收口、i18n 全量与构建验证`
