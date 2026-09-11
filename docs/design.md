# ShipMate 规格说明(Spec)

- 日期:2026-09-11
- 状态:已定稿(2026-09-11 老大拍板,决策记录见 §13)
- 来源:2026-09-11 brainstorming 会话定稿,本文件是唯一真相源
- 阶段:自用起步,架构留产品化余地

## 1. 定位

ShipMate 是 AI 原生的开发全生命周期管理平台:从需求素材(聊天记录、文档片段)出发,经 AI 分析提炼需求与需求点,到开发步骤跟进与全程变更审计。AI(通过 MCP)是与人平级的管理者,人与 agent 双通道操作同一套业务核心。

核心差异:传统工具(Jira、PingCode、ONES)是"流程记录器 + 外挂 AI 助手";ShipMate 中 AI 是一等公民,通过 MCP 直接读写需求库、更新进度、闭环开发流程。

### 1.1 已确认的关键决策

| 决策点       | 结论                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 目标用户     | 先自用验证,后产品化;架构为产品化留余地                                                                                           |
| 需求素材输入 | 手动粘贴起步(聊天记录、文档片段)                                                                                                 |
| 操作通道     | Web UI 与 MCP 双通道,共用同一 service 层(core)                                                                                   |
| 需求变更     | AI 分析结果可编辑;每次实质修改记变更链;需求点变更联动开发步骤                                                                    |
| 开发进度采集 | 先纯记录;git commit/PR 自动采集待评估,数据模型预留字段                                                                           |
| 技术栈       | TypeScript / Node 全栈                                                                                                           |
| 架构形态     | pnpm monorepo,三包:core / web / mcp                                                                                              |
| 数据库       | PostgreSQL(自建实例,2026-09-11 由老大部署)+ Drizzle ORM;连接串走 `.env` / settings,**真实凭据绝不进仓库**                        |
| LLM 接入     | OpenAI 兼容协议,base-url / model / key 配置化                                                                                    |
| 项目分组     | 项目之上加 Group 层(组织维度);项目可暂不入组                                                                                     |
| 系统管理     | 设置区四页:个人信息 / 模型设置(LLM 接入,落 settings 表,支持连接测试)/ 系统信息 / 数据管理(备份·导出·危险区);MCP 接入页归入设置区 |

## 2. 仓库与工程约定

```
shipmate/
├── packages/
│   ├── core/        # 领域逻辑:需求、变更链、联动规则、AI 分析编排
│   ├── web/         # Next.js UI,只调 core
│   └── mcp/         # MCP server,只调 core
├── docs/            # 本规格与后续文档
└── pnpm-workspace.yaml
```

- **运行时**:Node 22 LTS;一个 Node 进程承载 web + MCP HTTP(streamable);本地 Claude Code 走 stdio 指向同一 core
- **国际化**:web 包内建 i18n(next-intl),默认 `zh-CN`,文案全部走翻译键,预留 `en`;core/mcp 不含 UI 文案,无需 i18n
- **主题**:明暗双主题,next-themes(class 策略)+ CSS 变量;设计 tokens 深浅两套见 `shipmate.pen` 变量(light 为默认);跟随系统 + 手动切换,选择持久化 localStorage
- **语言**:TypeScript strict 模式;所有包 ESM
- **Lint/格式化**:ESLint + Prettier(成熟方案,业界主流;已定稿 D4)
- **测试**:vitest(core 单测 + mcp 集成测试);Playwright 仅 web 冒烟
- **依赖原则**:`web` 和 `mcp` 依赖 `core`,禁止反向;`core` 不依赖任何框架(不 import next / mcp sdk),数据库经由 drizzle-orm 注入

## 3. 领域模型(字段级)

层级:Group(分组)→ Project → Requirement → RequirementPoint → Task;横切 Material 与 ChangeLog。

所有表主键 `id: text`,取 UUID v7(时间有序,利于排序与审计)。

PostgreSQL 类型约定:所有时间戳列(`*_at` / `plan_*_at`)用 `bigint`(drizzle `mode: 'number'`),值为 Unix 毫秒(int4 放不下毫秒级时间戳);JSON 列(`source_material_ids` / `evidences` / `relations` / `commit_refs` / 快照)用 `jsonb`;`sort_order` / `version` 等计数列用 `integer`;状态/枚举列用 `text` + 应用层枚举约束(drizzle enum 参数),不用 PG 原生 enum(便于演进)。

### 3.0 groups(分组)

项目之上的组织维度(不同组织/团队的项目分开管理)。

| 字段                    | 类型                        | 说明           |
| ----------------------- | --------------------------- | -------------- |
| id                      | text PK                     | UUID v7        |
| name                    | text NOT NULL               | 分组名(组织名) |
| description             | text                        | 可空           |
| sort_order              | integer NOT NULL, default 0 | 分组展示排序   |
| created_at / updated_at | bigint NOT NULL             |                |

### 3.1 projects(项目)

| 字段        | 类型                | 说明                                  |
| ----------- | ------------------- | ------------------------------------- |
| id          | text PK             | UUID v7                               |
| group_id    | text FK→groups,可空 | 所属分组;可选,允许暂不入组(已定稿 D6) |
| name        | text NOT NULL       | 项目名                                |
| description | text                | 描述,可空                             |
| status      | text NOT NULL, enum | `active` / `archived`                 |
| created_at  | bigint NOT NULL     | Unix 毫秒                             |
| updated_at  | bigint NOT NULL     | Unix 毫秒                             |

### 3.2 analysis_runs(素材分析记录)

一次分析批次,可包含多条素材,产出需求归属该批次。

| 字段                      | 类型                      | 说明                                                 |
| ------------------------- | ------------------------- | ---------------------------------------------------- |
| id                        | text PK                   | UUID v7                                              |
| project_id                | text NOT NULL FK→projects |                                                      |
| title                     | text                      | 批次标题,可空(默认"素材分析 MM-DD HH:mm")            |
| status                    | text NOT NULL, enum       | `pending`(待分析)/ `done`(已完成)/ `failed`(失败)    |
| actor                     | text NOT NULL             | 发起者,见 §5.1                                       |
| draft_result              | jsonb, 可空               | 分析草稿暂存(spec §9:草稿不落业务表,暂存于 Run 自身) |
| created_at / completed_at | bigint NOT NULL / 可空    |                                                      |

### 3.3 materials(素材)

素材分析批次(Run)的输入;一次 Run 可含多条素材。

| 字段            | 类型                           | 说明                                                                 |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| id              | text PK                        | UUID v7                                                              |
| project_id      | text NOT NULL FK→projects      |                                                                      |
| analysis_run_id | text NOT NULL FK→analysis_runs | 所属分析批次                                                         |
| type            | text NOT NULL, enum            | `paste_text`(粘贴文本)/ `screenshot_text`(截图附文)/ `doc`(文档片段) |
| title           | text                           | 素材标题,可空                                                        |
| raw_content     | text NOT NULL                  | 原始内容                                                             |
| actor           | text NOT NULL                  | 录入者,见 §5.1                                                       |
| created_at      | bigint NOT NULL                |                                                                      |

### 3.4 requirements(需求)

AI 从素材归纳出的需求主题。

| 字段                    | 类型                        | 说明                                        |
| ----------------------- | --------------------------- | ------------------------------------------- |
| id                      | text PK                     | UUID v7                                     |
| project_id              | text NOT NULL FK→projects   |                                             |
| title                   | text NOT NULL               |                                             |
| summary                 | text                        | 摘要,可空                                   |
| status                  | text NOT NULL, enum         | `draft` / `confirmed` / `done` / `archived` |
| priority                | text NOT NULL, default `P2` | 优先级:P0(最高)/ P1 / P2 / P3               |
| plan_start_at           | bigint                      | 计划开始时间(Unix 毫秒),可空                |
| plan_due_at             | bigint                      | 预计完成时间(Unix 毫秒),可空;超期判定依据   |
| completed_at            | bigint                      | 实际完成时间(进入 done 时写入),可空         |
| created_at / updated_at | bigint NOT NULL             |                                             |

### 3.5 requirement_points(需求点)

| 字段                    | 类型                              | 说明                                                                                                  |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| id                      | text PK                           | UUID v7                                                                                               |
| requirement_id          | text NOT NULL FK→requirements     |                                                                                                       |
| title                   | text NOT NULL                     |                                                                                                       |
| description             | text                              | 可空                                                                                                  |
| status                  | text NOT NULL, enum               | `draft` / `confirmed` / `developing` / `done`,状态机见 §4                                             |
| version                 | integer NOT NULL, default 1       | 实质修改 +1,见 §5.2                                                                                   |
| source_material_ids     | text NOT NULL(JSON 数组)          | 溯源素材 id 列表,可多个                                                                               |
| evidences               | text NOT NULL(JSON 数组)          | 置信度依据:AI 引用的原素材原文段落 `[{material_id, quote}]`;为空时 UI/MCP 标注"无原文依据,需人工校验" |
| origin                  | text NOT NULL, default `analysis` | 来源:`analysis`(分析批次新建)/ `supplement`(补充进已有需求)/ `manual`                                 |
| relations               | text(JSON 数组),可空              | 冲突关系 `[{type:'duplicate'                                                                          | 'conflict', point_id, resolved?}]`;重复已并入、相悖已裁决时记 resolved |
| created_at / updated_at | bigint NOT NULL                   |                                                                                                       |

索引:`requirement_id`、`(requirement_id, status)`。

### 3.6 tasks(开发步骤)

| 字段                    | 类型                                | 说明                                                            |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------- |
| id                      | text PK                             | UUID v7                                                         |
| requirement_point_id    | text NOT NULL FK→requirement_points |                                                                 |
| title                   | text NOT NULL                       |                                                                 |
| description             | text                                | 可空                                                            |
| status                  | text NOT NULL, enum                 | `pending` / `in_progress` / `done` / `needs_reassessment`,见 §4 |
| sort_order              | integer NOT NULL, default 0         | 同一需求点内排序                                                |
| commit_refs             | text NOT NULL(JSON 数组)            | git 采集阶段(B)预留,当前恒为 `[]`                               |
| created_at / updated_at | bigint NOT NULL                     |                                                                 |

索引:`requirement_point_id`、`(requirement_point_id, sort_order)`。

### 3.7 change_logs(变更记录)

| 字段            | 类型                | 说明                                                                                                                           |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| id              | text PK             | UUID v7                                                                                                                        |
| entity_type     | text NOT NULL, enum | `group` / `project` / `analysis_run` / `material` / `requirement` / `requirement_point` / `task`                               |
| entity_id       | text NOT NULL       | 对应实体 id(多态引用,不设外键)                                                                                                 |
| change_type     | text NOT NULL, enum | `create` / `update` / `status_change` / `linkage_impact` / `discard`(作废 draft 时的快照留存) / `delete`(实体删除时的快照留存) |
| before_snapshot | text(JSON), 可空    | 变更前实体快照;`create` 时为 null                                                                                              |
| after_snapshot  | text(JSON)          | 变更后实体快照                                                                                                                 |
| reason          | text                | 变更原因,可空(工具入参可选传入)                                                                                                |
| actor           | text NOT NULL       | 见 §5.1                                                                                                                        |
| created_at      | bigint NOT NULL     |                                                                                                                                |

索引:`(entity_type, entity_id, created_at)`、`(entity_id)`。

说明:所有表(含 change_logs 本身)的写操作都写 change_logs;change_logs 自身的写入不再记录(防自环)。

### 3.8 settings(系统设置)

键值表,承载设置页管理的可变配置(LLM 接入参数、界面偏好等);环境变量仅作首次启动默认值。

| 字段       | 类型                | 说明                                                                                       |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------ |
| key        | text PK             | 如 `llm.base_url` / `llm.api_key` / `llm.model` / `ui.theme` / `ui.locale` / `backup.auto` |
| value      | text NOT NULL(JSON) | 值                                                                                         |
| updated_at | bigint NOT NULL     |                                                                                            |

## 4. 状态机

### 4.1 RequirementPoint

```
draft ──confirm──▶ confirmed ──start──▶ developing ──complete──▶ done
  ▲                   ▲                                    │
  └───────────────────┴───── 实质修改(developing/done 回退) ◀┘
```

| 当前态            | 动作                             | 目标态        | 说明                                                                                                  |
| ----------------- | -------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| draft             | confirm                          | confirmed     | 显式确认,人/AI 均可                                                                                   |
| confirmed         | start                            | developing    | 进入开发                                                                                              |
| developing        | complete                         | done          | 完成                                                                                                  |
| developing / done | 实质修改(title/description 变更) | **confirmed** | 版本 +1、写 ChangeLog、触发 Task 联动;需求点回 confirmed 待二次确认,确认后才可重新进入开发(已定稿 D2) |
| draft             | 实质修改                         | draft(保持)   | 版本 +1、写 ChangeLog,不触发状态变化,仍触发 Task 联动                                                 |

非法流转(如 done→developing)抛 `INVALID_STATUS_TRANSITION`。

### 4.2 Task

```
pending ──start──▶ in_progress ──complete──▶ done
   ▲                  │                        │
   └── confirm_reassessment ◀── needs_reassessment ─┘(任一状态均可被联动标记)
```

| 当前态             | 动作                 | 目标态             | 说明                                                                    |
| ------------------ | -------------------- | ------------------ | ----------------------------------------------------------------------- |
| pending            | start                | in_progress        |                                                                         |
| in_progress        | complete             | done               |                                                                         |
| 任意               | 联动标记             | needs_reassessment | 所属需求点实质修改时自动触发,见 §5.3                                    |
| needs_reassessment | confirm_reassessment | pending            | 二次确认后回到待办,重新走开发流程;原 done 的任务等同返工重排(已定稿 D3) |

### 4.3 Requirement / Project

- Requirement:`draft` →(confirm)`confirmed` →(complete)`done` →(archive)`archived`;需求下全部需求点 done 方可 complete(校验,提示不强拦);complete 时写入 `completed_at`
- **超期判定**:需求 status ∈ {draft, confirmed} 且 `plan_due_at` < 当前时间 → overdue。overdue 是**计算态不落库**,查询时算出,UI 徽章红色「已超期 N 天」;`plan_due_at` 临近(≤3 天)显示黄色「即将到期」;未设 `plan_due_at` 不参与超期判定
- Project:`active` ⇄ `archived`

## 5. 核心规则

### 5.1 actor 全记录

所有写操作必须携带 actor,取值约定:

| 格式            | 含义                | 来源                                                                                              |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `human`         | 人在 Web UI 操作    | web 门面固定传 `human`                                                                            |
| `mcp:<agent名>` | agent 经 MCP 操作   | mcp 门面从客户端标识推导(stdio 默认 `mcp:claude-code`,HTTP 取 clientInfo.name,缺省 `mcp:unknown`) |
| `ai:analysis`   | AI 分析流程自动创建 | core 内部分析编排固定使用                                                                         |

审计的根:每条数据谁写的、人写还是 AI 写,查 change_logs 即知。

### 5.2 实质修改与版本

- **实质修改** = title / description 字段内容变化;单纯状态流转不是实质修改
- 实质修改时:`version + 1` → 写 `change_type='update'` 的 ChangeLog(before/after 快照)→ 触发 Task 联动
- 状态流转写 `change_type='status_change'`,不动 version

### 5.3 变更联动(事务化)

RequirementPoint 实质修改时,core 在**同一事务**内完成四件事,要么全成要么全不动:

1. 更新需求点 + `version + 1`(状态规则见 §4.1)
2. 写该点的 ChangeLog(`update`)
3. 遍历其下所有 Task,标记 `status='needs_reassessment'`(已是该状态的跳过),各写一条 ChangeLog
4. 写一条需求点上的 `change_type='linkage_impact'` ChangeLog,记录联动影响范围(受影响 task 数)

### 5.4 AI 产出永远 draft

`analyze_material` 产出的 Requirement 与 RequirementPoint 一律 `draft` 态,confidence 再高也不自动 confirmed;confirm 是显式动作(`confirm_requirement_point`,人/AI 均可调)。

## 6. core 服务接口

core 按领域分组导出服务;每个写函数首参携带 `actor`。签名示意(实现时以 TS 为准):

```ts
// GroupService(分组:组织维度,项目之上的一层)
createGroup(input: { name, description? }, actor): Group
updateGroup(id, input: { name?, description?, sortOrder? }, actor): Group
deleteGroup(id, actor): void            // 组内仍有项目时抛 GROUP_NOT_EMPTY
getGroup(id): GroupSummary              // 含组内项目列表及各自完成度
listGroups(): Group[]                   // 含各组项目数;未分组项目由 listProjects(filter.groupId=null) 查

// ProjectService
createProject(input: { groupId?, name, description? }, actor): Project
updateProject(id, input: { name?, description?, status? }, actor): Project
getProject(id): ProjectSummary          // 含需求完成度、需求点状态分布、最近变更
listProjects(filter?: { groupId? }): Project[]

// AnalysisService(素材分析批次:一次 Run = N 条素材 → 产出需求)
createAnalysisRun(input: { projectId, title? }, actor): AnalysisRun
addMaterial(input: { runId, type, title?, rawContent }, actor): Material
startAnalysis(runId, actor): AnalysisResult           // 产出暂存 Run 草稿(不落业务表),见 §9;重复执行覆盖草稿
applyAnalysisRun(runId, options?: { selectedRequirements?: string[]; selectedSupplements?: string[]; decisions?: ConflictDecision[] }, actor): Requirement[]   // 选中项事务落库为 draft,默认全选;见 §9
listAnalysisRuns(projectId, filter?: { status? }): AnalysisRunSummary[]   // 含素材数与产出统计
getAnalysisRun(id): AnalysisRunDetail                 // 含全部素材与产出需求

// RequirementService
createRequirement(input: { projectId, title, summary?, priority?, planStartAt?, planDueAt? }, actor): Requirement
updateRequirement(id, input: { title?, summary?, status?, priority?, planStartAt?, planDueAt? }, actor): Requirement
listRequirements(projectId, filter?: { status?, priority?, overdue? }): Requirement[]   // 返回含 overdue/overdueDays 计算字段

// RequirementPointService
listRequirementPoints(filter: { requirementId? / projectId? / status? }): RequirementPoint[]
getRequirementPoint(id): RequirementPointDetail      // 含完整变更历史
updateRequirementPoint(id, input: { title?, description?, reason? }, actor): RequirementPoint
   // 实质修改:version+1 + ChangeLog + Task 联动,同一事务
setRequirementPointStatus(id, action: 'confirm' | 'start' | 'complete', actor): RequirementPoint
confirmRequirementPoint(id, actor): RequirementPoint  // setRequirementPointStatus(id,'confirm') 的别名

// TaskService
createTask(input: { requirementPointId, title, description?, sortOrder? }, actor): Task
updateTask(id, input: { title?, description?, sortOrder? }, actor): Task
setTaskStatus(id, action: 'start' | 'complete', actor): Task
listTasks(filter: { requirementPointId? / projectId? / status? }): Task[]
confirmTaskReassessment(id, actor): Task

// AuditService
getChangeLog(filter: { entityType, entityId, limit? }): ChangeLog[]
getProjectAuditReport(projectId): AuditReport        // 全量变更时间线 + actor 分布(人/AI 操作占比)
```

约定:

- 所有服务函数接收 drizzle 实例(构造时注入),core 不隐含全局单例
- 联动事务在 core 内部用 `db.transaction` 包裹,门面无感
- `getProjectSummary` / `getRequirementPointDetail` / `AuditReport` 为只读聚合结构,字段实现时定

## 7. 错误模型

core 层统一 `DomainError`(带 code),web 映射 HTTP 状态码,mcp 映射 `isError`,两门面不各写一套错误逻辑。

| code                          | 含义                             | HTTP 映射 |
| ----------------------------- | -------------------------------- | --------- |
| `NOT_FOUND`                   | 任意实体不存在                   | 404       |
| `VALIDATION_ERROR`            | 入参不合法(zod 校验失败)         | 400       |
| `INVALID_STATUS_TRANSITION`   | 状态机非法流转                   | 409       |
| `GROUP_NOT_EMPTY`             | 分组下仍有项目,禁止删除          | 409       |
| `PROJECT_HAS_NO_REQUIREMENTS` | Requirement confirm 前置校验失败 | 409       |
| `LLM_ERROR`                   | LLM 调用失败(网络/超时/鉴权)     | 502       |
| `LLM_SCHEMA_MISMATCH`         | LLM 返回不合 JSON schema         | 502       |
| `INTERNAL`                    | 未预期错误                       | 500       |

规则:LLM 失败明确报错返回,不静默降级、不落脏数据。

## 8. MCP 工具面

原则:MCP 零业务逻辑,薄壳调 core;写操作自动记 actor;入参用 zod schema 定义并生成工具 JSON Schema。

| 分组       | 工具                           | 入参要点                                                        | 返回要点                                                                                                                                                                                             |
| ---------- | ------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分组       | `create_group`                 | name, description?                                              | 分组对象                                                                                                                                                                                             |
|            | `update_group`                 | id, name?/description?/sortOrder?                               | 分组对象                                                                                                                                                                                             |
|            | `delete_group`                 | id                                                              | 组内仍有项目时报 `GROUP_NOT_EMPTY`                                                                                                                                                                   |
|            | `list_groups`                  | 无                                                              | 分组数组,含各组项目数                                                                                                                                                                                |
|            | `get_group`                    | id                                                              | 分组 + 组内项目列表及各自完成度                                                                                                                                                                      |
| 项目       | `create_project`               | groupId?, name, description?                                    | 项目对象                                                                                                                                                                                             |
|            | `update_project`               | id, name?/description?/status?                                  | 项目对象                                                                                                                                                                                             |
|            | `list_projects`                | status?                                                         | 项目数组                                                                                                                                                                                             |
|            | `get_project`                  | id                                                              | 项目 + 需求完成度 + 需求点状态分布 + 超期需求数 + 最近 20 条变更                                                                                                                                     |
| 素材       | `add_material`                 | projectId, type, rawContent, title?, analyze?                   | 素材对象;analyze=true 时附分析摘要                                                                                                                                                                   |
|            | `list_materials`               | projectId                                                       | 素材数组                                                                                                                                                                                             |
|            | `get_material`                 | id                                                              | 素材对象                                                                                                                                                                                             |
| 素材分析   | `create_analysis_run`          | projectId, title?                                               | 分析记录对象(pending)                                                                                                                                                                                |
|            | `add_material`                 | runId, type, rawContent, title?                                 | 素材对象;同一 Run 可多次调用添加多条                                                                                                                                                                 |
|            | `start_analysis`               | runId                                                           | 产出暂存 Run 草稿(不落业务表);重复执行覆盖草稿                                                                                                                                                       |
|            | `apply_analysis_run`           | runId, selectedRequirementIds?, conflictDecisions?              | 选中需求事务落库为 draft(默认全选);相悖块必须携带裁决结果(用新/用旧/都保留),重复块携带处置(并入/仍要新建/跳过);草稿块以 title 定位(草稿未落库无 id),selectedRequirementIds 语义即草稿需求 title 数组 |
|            | `list_analysis_runs`           | projectId, status?                                              | 分析记录数组,含素材数与产出统计                                                                                                                                                                      |
|            | `get_analysis_run`             | id                                                              | 记录 + 全部素材 + 草稿产出                                                                                                                                                                           |
| 需求       | `create_requirement`           | projectId, title, summary?, priority?, planStartAt?, planDueAt? | 需求对象                                                                                                                                                                                             |
|            | `update_requirement`           | id, title?/summary?/status?/priority?/planStartAt?/planDueAt?   | 需求对象                                                                                                                                                                                             |
|            | `list_requirements`            | projectId, status?/priority?/overdue?                           | 需求数组,含 overdue/overdueDays 计算字段                                                                                                                                                             |
| 需求点     | `list_requirement_points`      | requirementId?/projectId?/status?                               | 需求点数组                                                                                                                                                                                           |
|            | `get_requirement_point`        | id                                                              | 需求点 + 完整变更历史 + 关联任务 + evidences 溯源                                                                                                                                                    |
|            | `update_requirement_point`     | id, title?/description?, reason?                                | 更新后需求点(附联动影响 task 数)                                                                                                                                                                     |
|            | `set_requirement_point_status` | id, action(confirm/start/complete)                              | 需求点对象                                                                                                                                                                                           |
|            | `confirm_requirement_point`    | id                                                              | 需求点对象(confirm 别名,语义化给 AI 用)                                                                                                                                                              |
| 开发步骤   | `create_task`                  | requirementPointId, title, description?, sortOrder?             | 任务对象                                                                                                                                                                                             |
|            | `update_task`                  | id, title?/description?/sortOrder?                              | 任务对象                                                                                                                                                                                             |
|            | `set_task_status`              | id, action(start/complete)                                      | 任务对象                                                                                                                                                                                             |
|            | `list_tasks`                   | requirementPointId?/projectId?/status?                          | 任务数组                                                                                                                                                                                             |
|            | `confirm_task_reassessment`    | id                                                              | 任务对象                                                                                                                                                                                             |
| 审计与进度 | `get_change_log`               | entityType, entityId, limit?                                    | 变更时间线                                                                                                                                                                                           |
|            | `get_project_audit_report`     | projectId                                                       | 时间线 + actor 分布 + 实体类型分布 + 每日变更计数(趋势)                                                                                                                                              |
|            | `get_project_progress`         | projectId                                                       | 按需求聚合的任务完成度、需求点状态分布、超期/临近到期清单                                                                                                                                            |

传输:stdio(本地 Claude Code)+ HTTP streamable(其他 agent/远程),共用同一 core。

## 9. AI 分析流程

`start_analysis(runId)` 主链路(以分析批次为单位,一次吃掉 Run 内全部素材):

```
AnalysisRun(pending)
  → 汇集 Run 内全部 Material 的 raw_content(带类型与标题标注)
  → LLM 结构化输出(强制 JSON schema;输入注入项目已有需求/需求点摘要,供标注重复与相悖):
      { requirements: [ { title, summary,
          points: [ { title, description, confidence,
            evidences: [ { material_id, quote } ] } ] } ],
        supplements: [ { target_requirement_title,
          points: [ { title, description, confidence,
            evidences: [ { material_id, quote } ] } ] } ] }
  → 产出暂存为 Run 草稿(不进业务表),Run.status = done
  → Web 端编辑草稿:新增/删除需求与需求点、勾选所需需求(默认全选)
  → apply_analysis_run:选中项事务落库为 Requirement + RequirementPoint
     (draft 态,source_material_ids 回填到具体素材),追加至需求列表
```

规则:

1. 模型接入走 OpenAI 兼容协议(`/chat/completions` + JSON mode / tool-call 结构化输出),base-url / model / key 配置化,不绑厂商
2. AI 产出永远 `draft`:应用落库后即 draft 态,confirm 后才进 confirmed(见 §5.4)
3. 同步执行:素材手动粘贴量小,直接 await,不做 job 队列(YAGNI)
4. 失败即回滚:LLM 失败 → `Run.status = failed`;草稿仅存于 Run 自身,不产生业务表脏数据;apply 落库为单事务,要么全成要么全不动
5. confidence 仅作展示字段,不参与状态决策;**置信度必须可溯源** — 每个需求点要求附 evidences(引用具体素材的原文段落),evidences 为空的点标注"无原文依据,需人工校验",不阻塞落库,由人定夺
6. **重新分析同一批次**:直接覆盖 Run 草稿(未应用的产出随之替换,无审计负担);已应用落库的需求不受影响。`discard` 枚举保留,用于应用后删除 draft 需求的场景
7. 后期增强位(当前不做):需求点细化 Task 草案、需求点重复/冲突检测的自动化(embedding 相似度);当前重复/相悖由 LLM 标注 + apply 时 core 兜底
8. **重复/相悖/补充处理**(多批次分析的必然冲突,三类均不静默):
   - **duplicate 重复**:草稿块打「与已有需求重复」标,默认动作"素材并入已有需求点"(evidences 追加 + ChangeLog);用户可选"仍要新建"(新点 relations 记 duplicate_of,UI 常驻「重复」标)
   - **contradiction 相悖**:**强制人工裁决**,未裁决不能应用该块 — 用新(旧点自动打 `needs_reassessment`,写 conflict ChangeLog)/ 用旧(草稿丢弃)/ 都保留(双向 relations 记 conflict_with)
   - **supplement 补充**:草稿中把匹配到的**已有需求块整体带出** — 已有需求点按实时状态展示(done/developing/…),新增点打「补充」标(origin=supplement);应用时仅追加新点到已有需求下,已有点不动
   - 注:本条所述「conflict ChangeLog」落地为任务 status_change + 需求点 update 两种既有类型(ChangeType 枚举无 conflict 专用值),冲突语境经 reason 字段标注

## 10. 配置

全部环境变量 / `.env`(仅作**首次启动默认值**,之后以设置页(settings 表)为准):

| 变量                         | 默认        | 说明                                                                                        |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `SHIPMATE_DATABASE_URL`      | 无,必填     | PostgreSQL 连接串 `postgresql://user:pass@host:port/db`;凭据仅存 `.env`(gitignore),不进仓库 |
| `SHIPMATE_TEST_DATABASE_URL` | 无,测试必填 | 测试库连接串;与主库相同实例,测试以事务回滚保证零残留                                        |
| `SHIPMATE_LLM_BASE_URL`      | 无,必填     | OpenAI 兼容端点                                                                             |
| `SHIPMATE_LLM_API_KEY`       | 无,必填     |                                                                                             |
| `SHIPMATE_LLM_MODEL`         | 无,必填     | 模型名                                                                                      |
| `SHIPMATE_HTTP_PORT`         | `47610`     | web + MCP HTTP 共用端口;刻意避开 3XXX/8XXX 等常见开发端口段防冲突                           |

LLM 接入参数(base-url / api-key / model / temperature / 超时)在「设置 → 模型设置」页管理,落 settings 表,支持连接测试;改后即时生效,无需重启。

stdio 模式下仅需 DB + LLM 配置,不监听端口。

## 11. 测试策略

重心在 core:

- **core 单测**:联动规则、状态机、变更记录、actor 记录,业务心脏全覆盖;连接真实 PostgreSQL 测试库,**事务回滚隔离**(每用例外层事务 + 强制 ROLLBACK,零残留,无需 CREATEDB 权限)
- **MCP 集成测试**:起 server 调工具,断言行为与 actor 记录正确
- **AI 分析**:CI 内 mock LLM(录制回放);schema 校验单独测;真实模型调用手动触发,不进 CI
- **web**:Playwright 冒烟若干主路径,不过度投入

## 12. 范围外(当前不做)

- 飞书/钉钉/企微等素材自动同步(素材表已留 type 扩展位)
- git commit/PR 自动采集(`commit_refs` 字段已预留)
- 需求点细化 Task 草案、重复/冲突检测
- 多租户、权限体系(产品化阶段再议)

## 13. 决策记录(2026-09-11 定稿)

| #   | 问题                         | 结论                                                                                                     |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | 主键形态                     | UUID v7 text(时间有序,多态引用统一,agent 拿到 id 即可用)                                                 |
| D2  | 需求点实质修改后状态         | developing/done 回退 confirmed;需求点待二次确认,确认后才重新进入开发;下游 Task 同步打 needs_reassessment |
| D3  | done 的 Task 被联动标记后    | 二次确认(confirm_reassessment)后回 pending,返工重排,不留在 done                                          |
| D4  | Lint/格式化                  | ESLint + Prettier(成熟方案)                                                                              |
| D5  | Requirement confirm 前置校验 | 仅提示不强拦(自用灵活优先,后续有需要再收紧)                                                              |
| D6  | 项目入组                     | 分组可选,group_id 可空,允许暂不入组                                                                      |
| D7  | 数据库                       | PostgreSQL 替代 SQLite(2026-09-11 老大提供自建实例);测试用同库事务回滚隔离,凭据只存 `.env`(gitignore)    |

## 14. 页面交互与动效(Web 实现)

原型(P7 页为准的 7 个页面)为静态稿;动效按下表规格在 web 包实现(纯 CSS transition 优先,复杂反馈用 framer-motion)。原则:快而不晃,单个动效 ≤ 240ms,不做弹跳类缓动。

| 交互                       | 规格                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏三态                   | 左侧项目菜单共三种形态,点击左上角 ShipMate 图标**循环切换**:①**完全展开** 240px(分组 + 项目数完整列表,P1);②**折叠展示** 64px 图标栏(hover 出 tooltip 显示分组名与项目数,延迟 300ms,P1b);③**完全隐藏** 0px(内容区占满,P2-P7 各页即为隐藏态示例)。宽度过渡 `240ms cubic-bezier(0.2,0,0,1)`;图标/文字交叉淡入淡出 `150ms`;形态选择按页面记忆 |
| 页面切换                   | 内容区淡入 + 8px 上移,`120ms ease-out`;路由切换不整页白屏(Next.js App Router 段内过渡)                                                                                                                                                                                                                                                    |
| 卡片 hover                 | 边框色过渡到 accent + 阴影加深,`120ms`;无位移缩放                                                                                                                                                                                                                                                                                         |
| 需求点 确认/状态流转       | 按钮点击 `scale(0.97)` 按压反馈 `80ms`;状态徽章切换时底色/文字交叉淡入 `150ms`                                                                                                                                                                                                                                                            |
| 看板任务卡                 | 拖拽抬起:阴影 + `scale(1.02)`,`120ms`;落位占位符呼吸提示;needs_reassessment 列卡片保留警示顶条                                                                                                                                                                                                                                            |
| 复制类操作(MCP 接入配置等) | 点击后按钮文案切换"已复制 ✓",`1.5s` 后回落                                                                                                                                                                                                                                                                                                |
| 素材分析触发               | 点击后按钮进入 loading(✦ 旋转),结果区域骨架屏(渐变呼吸)占位;分析完成结果卡逐条 stagger 淡入(每条间隔 40ms)                                                                                                                                                                                                                                |
| 变更历史时间线             | 新增记录插入时从顶部滑入 `180ms`;linkage_impact 类型徽章微光警示                                                                                                                                                                                                                                                                          |
| 顶栏右侧收纳               | 顶栏**只放头像**,不放任何散置按钮。点击头像展开下拉菜单(`120ms` 淡入 + 4px 下移):用户信息、深色模式开关、`中/EN` 语言切换、**设置**(个人信息/模型设置/系统信息/数据管理)、MCP 接入入口、退出登录;主题明暗即时切换 `150ms`,选择均持久化                                                                                                    |
| 空状态                     | 分组无项目/无素材时展示引导插图 + 主操作按钮,不展示空白区域                                                                                                                                                                                                                                                                               |

导航结构约定:所有页面左侧固定侧栏(可折叠),左上角 ShipMate 图标是侧栏折叠开关,不承担"回到首页"职责;回到首页走侧栏"全部项目"项。顶栏只放头像,下拉收纳主题/语言/MCP 接入/退出。

页面跳转关系:P1 项目卡片(整卡可点,右侧「进入项目 ›」)→ P2 项目概览;项目 Tab 组五项:**概览(P2)/ 需求分析(P3)/ 进度(P5b)/ 任务看板(P5)/ 审计(P6)**。素材与需求同属需求分析阶段,合并在 P3 一个 Tab 内:上半为**素材分析记录卡流**(每卡 = 一次分析批次:N 条素材 → 产出统计),下半为需求列表(产出,draft 置顶待确认);数据层 AnalysisRun / Material / Requirement 为独立实体,合并的只是界面流程。| P3 点分析记录或「新增素材分析」→ P3c 素材分析页(左:本次批次素材列表,可新增多条后「开始分析」;右:分析产出草稿 — 需求块**左上角勾选角标**表达选中态,默认全选、点卡片切换,需求与需求点均可新增/删除;重复块打「与已有需求重复」标默认"素材并入",相悖块标「⚡ 与 X 相悖」**强制人工裁决**(用新/用旧/都保留),补充块带出完整已有需求(已有点实时状态 + 新点「补充」标);右上「应用」→ P3d 确认弹窗「请确认,所选需求将全部追加到需求列表中」→ 选中项以 draft 态追加至 P3 需求产出列表),完成后返回 P3;P3 产出卡「📄 原文依据」→ P3b 依据 Modal。需求点行「详情 ›」→ P4 需求点详情,面包屑逐级回退;P4「编辑(实质修改)」→ P4b 编辑弹窗(reason 必填,弹窗内预览联动后果:version+1 / 状态回退 / 关联任务转待重估);P5 待重估卡「确认重估」→ P5c 重估确认弹窗(展示进入重估的原因、需求点变更对比链接,确认后任务回 pending,原完成记录留审计);P5 待重估列卡片点击 → 对应 P4;项目上下文条(项目名 + Tab 组)在 P3/P3c/P4/P5/P5b/P6 常驻,当前 Tab 高亮。
