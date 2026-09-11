# ShipMate MCP 包 实施计划(Plan 2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `@shipmate/mcp`——把 core 的 33 个领域能力以 MCP 工具面暴露(stdio + HTTP streamable 双传输),零业务逻辑薄壳,供 Claude Code 等 agent 直接读写需求库。

**Architecture:** MCP SDK 的 `McpServer.registerTool` 注册工具(zod 入参);handler 只做「zod 校验后调 core → 结果 JSON 序列化 / DomainError → isError」。传输两用:stdio(CLI 入口)+ Web 标准 streamable handler(由 web 包挂载到 `/api/mcp` 路由)。actor 由服务器构造时确定。

**Tech Stack:** TypeScript 5 strict + ESM(nodenext)、@modelcontextprotocol/sdk ^1.x、zod ^3、vitest。

**Spec:** `docs/design.md` §8(MCP 工具面)、§5.1(actor 推导)、§7(错误映射)、§10(传输)。core 包已完成(main@110ac71),所有领域能力经 `createCore(db)` 消费——**实现各任务时以 `packages/core/src/index.ts` 的导出与 `packages/core/src/services/*.ts` 的真实签名为准,本计划只给工具面映射**。

## Global Constraints(每个任务默认遵守)

- Node >= 22,pnpm >= 9;ESM + nodenext,**包内相对导入带 `.js` 后缀**;TS strict。
- mcp 依赖白名单:`@modelcontextprotocol/sdk`、`zod`、`@shipmate/core`(workspace:^);dev:`vitest`、`tsx`、`@types/node`。禁止引入 express/next 等框架。
- **零业务逻辑**:handler 不写 if 业务分支、不算完成度、不拼需求摘要——一切经 core;工具层只做「入参透传 + 结果/错误序列化」。
- actor 推导(spec §5.1):stdio 服务器固定 `mcp:claude-code`;HTTP streamable 从 initialize 请求的 `clientInfo.name` 取 → `mcp:<name>`,缺省 `mcp:unknown`。actor 在 createServer 时注入,handler 闭包使用。
- 工具名 snake_case,与 spec §8 表逐字一致;description 用中文(给 agent 的语义提示)。
- 成功返回:`{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`;`DomainError` → `{ isError: true, content: [{ type: 'text', text: \`${code}: ${message}\` }] }`;未知错误 → 同形态、code 用 `INTERNAL`。统一走 util 的 `ok()` / `fail()`。
- 异步工具(startAnalysis 等)直接 await,不设超时包装(LLM 层已有 120s 超时)。
- 测试连真实 PostgreSQL(同 core:`loadDotEnv` + `SHIPMATE_TEST_DATABASE_URL`,withDb 事务回滚);MCP 侧用 SDK 的 `InMemoryTransport` 成对连接做 client→server 调用断言。
- commit message 中文,**禁止任何 Co-Authored-By AI 署名**;绝不 add/commit `.env`。
- **工具名冲突裁定(Ruling,已定)**:spec §8 素材组的 `add_material(projectId…)` 与分析组的 `add_material(runId…)` 同名——只保留 **runId 版**(素材必属批次);spec §8 该行由收口任务回写。

## File Structure

```
packages/mcp/
├── package.json          # bin: { "shipmate-mcp": "./src/cli.ts" }
├── tsconfig.json
├── vitest.config.ts      # 同 core 风格;setupFiles 复用 core 的 test-setup(相对导入 ../../core/src/test-setup.ts 不可行——自建薄 setup 调 core 的 loadDotEnv)
└── src/
    ├── index.ts          # createMcpServer(db, actor): McpServer —— 注册全部工具
    ├── cli.ts            # stdio 入口:loadDotEnv → createDatabase(SHIPMATE_DATABASE_URL) → createMcpServer(db,'mcp:claude-code') → StdioServerTransport
    ├── http.ts           # createMcpHttpHandler(db): (request: Request) => Promise<Response> —— Web 标准 streamable
    ├── util.ts           # ok/fail/toToolHandler(包装 DomainError 映射)
    └── tools/
        ├── groups.ts     # registerGroupTools(server, core, actor)
        ├── projects.ts
        ├── analysis.ts   # 含素材 list/get
        ├── requirements.ts
        ├── points.ts
        ├── tasks.ts
        └── audit.ts      # 审计 + 进度
```

---

### Task 1: 包脚手架、错误映射与测试管道

**Files:** Create `packages/mcp/{package.json,tsconfig.json,vitest.config.ts}`、`src/{util.ts,index.ts}`、`src/util.test.ts`

**Interfaces(Produces):**
- `ok(result: unknown) => { content: [{type:'text', text: string}] }`
- `fail(e: unknown) => { isError: true, content: [{type:'text', text: string}] }`(DomainError → `"CODE: message"`;其余 → `"INTERNAL: <message>"`)
- `type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>`;`withCore<A>(core: ShipmateCore, actor: Actor, fn: (core: ShipmateCore) => Promise<unknown>): ToolHandler` —— 统一 try/catch 包装
- `createMcpServer(db: ShipmateDb, actor: Actor): McpServer`(Task 1 先空注册,后续任务填充)

**Steps:**
- [ ] 写 `util.test.ts`:ok 序列化、DomainError 映射 code、未知错误 INTERNAL(GREP 断言文本);写失败测试
- [ ] 跑红:`pnpm -C packages/mcp test`
- [ ] 实现 util + 空 server(`new McpServer({ name: 'shipmate', version: '0.1.0' })`)
- [ ] 跑绿 + `pnpm -C packages/mcp typecheck`;根 `pnpm install` 让 workspace 链接生效
- [ ] Commit:`feat(mcp): 包脚手架、错误映射与测试管道`

---

### Task 2: 分组与项目工具(9 个)

**Files:** Create `src/tools/groups.ts`、`src/tools/projects.ts`;Modify `src/index.ts`;Test `src/tools/groups.test.ts`

**Interfaces:** `registerGroupTools(server, core, actor)` / `registerProjectTools(server, core, actor)`

**工具清单(zod 入参 → core 调用,逐一对应):**

| 工具名 | zod 入参 | core 调用 |
|--------|----------|-----------|
| `create_group` | `{ name: z.string(), description: z.string().optional() }` | `core.groups.createGroup(input, actor)` |
| `update_group` | `{ id: z.string(), name/description/sortOrder 各 optional }` | `core.groups.updateGroup(id, input, actor)` |
| `delete_group` | `{ id: z.string() }` | `core.groups.deleteGroup(id, actor)` |
| `list_groups` | `{}` | `core.groups.listGroups()` |
| `get_group` | `{ id: z.string() }` | `core.groups.getGroup(id)` |
| `create_project` | `{ groupId: z.string().optional(), name: z.string(), description: z.string().optional() }` | `core.projects.createProject(input, actor)` |
| `update_project` | `{ id: z.string(), name/description/status('active'\|'archived') optional }` | `core.projects.updateProject(id, input, actor)` |
| `list_projects` | `{ groupId: z.string().nullable().optional() }` | `core.projects.listProjects(filter)`(groupId 未传 → `{}`;null → `{ groupId: null }`) |
| `get_project` | `{ id: z.string() }` | `core.projects.getProject(id)` |

**注册模式模板(groups.ts 全文,后续任务照此):**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ShipmateCore } from '@shipmate/core';
import type { Actor } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerGroupTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_group',
    {
      title: '创建分组',
      description: '创建项目分组(组织维度)',
      inputSchema: { name: z.string().describe('分组名'), description: z.string().optional().describe('描述') },
    },
    withCore(core, actor, (c, args) => c.groups.createGroup(args as { name: string; description?: string }, actor)),
  );
  // …其余 4 个同构
}
```

注:`registerTool` 的 handler 签名以安装的 SDK 实际类型为准(inputSchema 传 zod shape 的 record;若 SDK 要求 `z.object` 整体,适配之——**不猜接口,先查 node_modules 里 SDK 的 d.ts**)。`withCore` 的 fn 收 `(core, parsedArgs)`。

**Steps:** 写测试(起 InMemoryTransport 连接,client.callTool 断言 create_group 落库 + delete_group 组内非空返回 isError 含 GROUP_NOT_EMPTY)→ 跑红 → 实现 → 跑绿 → index.ts 注册 → Commit:`feat(mcp): 分组与项目工具(9 个)`

---

### Task 3: 需求 / 需求点 / 任务工具(13 个)

**Files:** Create `src/tools/requirements.ts`、`src/tools/points.ts`、`src/tools/tasks.ts`;Modify `src/index.ts`;Test 各自 `.test.ts`

**工具清单:**

| 工具名 | core 调用 |
|--------|-----------|
| `create_requirement` | `core.requirements.createRequirement({ projectId, title, summary?, priority?, planStartAt?, planDueAt? }, actor)`(时间入参 z.number().int() 毫秒) |
| `update_requirement` | `core.requirements.updateRequirement(id, input, actor)`(status/priority 枚举 z.enum) |
| `list_requirements` | `core.requirements.listRequirements(projectId, filter)`(返回含 overdue/overdueDays/dueSoon 计算字段) |
| `list_requirement_points` | `core.points.listRequirementPoints(filter)` |
| `get_requirement_point` | `core.points.getRequirementPoint(id)`(含变更历史 + 任务 + evidences) |
| `update_requirement_point` | `core.points.updateRequirementPoint(id, { title?, description?, reason? }, actor)` |
| `set_requirement_point_status` | `core.points.setRequirementPointStatus(id, action, actor)`(action z.enum(['confirm','start','complete'])) |
| `confirm_requirement_point` | `core.points.confirmRequirementPoint(id, actor)`(语义化别名) |
| `create_task` | `core.tasks.createTask(input, actor)` |
| `update_task` | `core.tasks.updateTask(id, input, actor)` |
| `set_task_status` | `core.tasks.setTaskStatus(id, action, actor)`(z.enum(['start','complete'])) |
| `list_tasks` | `core.tasks.listTasks(filter)` |
| `confirm_task_reassessment` | `core.tasks.confirmTaskReassessment(id, actor)` |

**Steps:** 同 Task 2 模式;测试至少覆盖:list_requirements 的 overdue 字段、update_requirement_point 联动后返回 affectedTaskCount、set_requirement_point_status 非法流转 isError 含 INVALID_STATUS_TRANSITION → 跑绿 → Commit:`feat(mcp): 需求/需求点/任务工具(13 个)`

---

### Task 4: 素材与分析工具(8 个,含异步 LLM)

**Files:** Create `src/tools/analysis.ts`;Modify `src/index.ts`;Test `src/tools/analysis.test.ts`

**工具清单:**

| 工具名 | core 调用 |
|--------|-----------|
| `create_analysis_run` | `core.analysis.createAnalysisRun({ projectId, title? }, actor)` |
| `add_material` | `core.analysis.addMaterial({ runId, type: z.enum(['paste_text','screenshot_text','doc']), rawContent, title? }, actor)` |
| `list_materials` | `core.analysis.getAnalysisRun(runId).materials`(以 runId 为入参,zod `{ runId: z.string() }`) |
| `get_material` | 从 run 素材数组按 id 过滤(纯透传查询,无业务逻辑) |
| `start_analysis` | `await core.analysis.startAnalysis(runId, actor)`(异步,LLM 真调;description 写明"同步执行,耗时取决于模型") |
| `apply_analysis_run` | `core.analysis.applyAnalysisRun(runId, { selectedRequirements?, selectedSupplements?, decisions? }, actor)`;decisions zod:`z.array(z.object({ requirementTitle: z.string(), resolution: z.enum(['merge','create_anyway','skip','use_new','use_old','keep_both']) }))` |
| `list_analysis_runs` | `core.analysis.listAnalysisRuns(projectId, filter?)` |
| `get_analysis_run` | `core.analysis.getAnalysisRun(id)`(含草稿) |

**测试注意:** start/apply 用注入 fake LlmInvoker 的 AnalysisService?不行——工具层走 core.analysis(生产工厂)。测试方案:测试内不调 start_analysis 真路径,改为**直接 SQL 置 draftResult 后调 apply_analysis_run**(同 core 的 T14 seedDraft 模式);start_analysis 仅断言"空素材 → isError 含 VALIDATION_ERROR"。LLM 全链路已有 core 测试覆盖,MCP 层不重复。

**Steps:** 同模式 → 跑绿 → Commit:`feat(mcp): 素材与分析工具(8 个,含冲突三分类应用)`

---

### Task 5: 审计与进度工具(3 个)

**Files:** Create `src/tools/audit.ts`;Modify `src/index.ts`;Test `src/tools/audit.test.ts`

| 工具名 | core 调用 |
|--------|-----------|
| `get_change_log` | `core.audit.getChangeLog({ entityType: z.enum(7 值), entityId, limit? })` |
| `get_project_audit_report` | `core.audit.getProjectAuditReport(projectId)` |
| `get_project_progress` | `core.projects.getProject(projectId)`(概要即进度:完成度/点分布/超期数/最近变更;description 写明) |

**Steps:** 同模式 → 跑绿 → Commit:`feat(mcp): 审计与进度工具(3 个)`

---

### Task 6: stdio CLI 与 HTTP streamable

**Files:** Create `src/cli.ts`、`src/http.ts`、`packages/mcp/package.json` 补 bin;Test `src/http.test.ts`

**cli.ts 骨架:**

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadDotEnv, createDatabase } from '@shipmate/core';
import { createMcpServer } from './index.js';

loadDotEnv();
const url = process.env.SHIPMATE_DATABASE_URL;
if (!url) throw new Error('缺少 SHIPMATE_DATABASE_URL');
const db = await createDatabase(url);
const server = createMcpServer(db, 'mcp:claude-code');
await server.connect(new StdioServerTransport());
console.error('shipmate-mcp stdio ready'); // stderr!stdout 是协议通道
```

**http.ts 骨架**(SDK 导出名以 node_modules 实际为准,常见 `WebStandardStreamableHTTPServerTransport`):

```ts
export function createMcpHttpHandler(db: ShipmateDb): (request: Request) => Promise<Response> {
  // 每个 session 一个 transport + server(actor 从 clientInfo.name 推导,缺省 mcp:unknown)
  // 实现要点:POST 处理协议消息;GET(SSE)按 SDK 支持度透传;session 管理用 Map<sessionId, transport>
}
```

actor 推导:从 initialize 请求体 `params.clientInfo.name` 提取(JSON-RPC 解析一层的字符串匹配即可,SDK 内部消费原始流——若 SDK 不暴露,则在 handler 外层轻解析 POST body 的 initialize 帧,只读不改写)。

**Steps:** http 测试(InMemory 不能测 Web 流——用 fetch 层断言 initialize 响应含 serverInfo;或按 SDK 文档的最小 streamable 客户端)→ 实现 → `node --import tsx src/cli.ts` 手验 stdio 起动(立即 Ctrl+C)→ Commit:`feat(mcp): stdio CLI 与 HTTP streamable 传输`

---

### Task 7: 集成回归、README 与 spec 回写

**Files:** Modify `packages/mcp/README.md`、`docs/design.md`(§8 add_material 同名裁定回写:素材组 add_material(projectId) 删除,素材必属批次)

**Steps:**
- [ ] 全量回归:`pnpm -C packages/mcp test` + `pnpm -C packages/core test`(core 不得回归)+ 双包 typecheck + 根 lint/format:check
- [ ] README:工具清单表(33 个)、Claude Code 接入配置示例(mcpServers json:command node --import tsx packages/mcp/src/cli.ts)、HTTP 端点说明(由 web 挂载 /api/mcp)
- [ ] design.md §8 回写 + 工具总数核对(33 个:分组 5/项目 4/素材 2/分析 6/需求 3/需求点 5/任务 5/审计进度 3)
- [ ] Commit:`docs(mcp): README、工具清单与 spec §8 回写`
