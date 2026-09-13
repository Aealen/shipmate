# @shipmate/mcp

ShipMate 的 MCP(Model Context Protocol)工具面:把 core 的 35 个领域能力以 MCP 工具暴露,供 Claude Code 等 agent 直接读写需求库。零业务逻辑薄壳——handler 只做「zod 校验后调 core → 结果 JSON 序列化 / DomainError → isError」。

- **actor 审计**:stdio 服务器固定 `mcp:claude-code`;HTTP streamable 从 initialize 的 `clientInfo.name` 推导为 `mcp:<name>`(缺省 `mcp:unknown`),全部写操作自动落 change_logs。
- **错误映射**:`DomainError` → `isError: true` + 文本 `"CODE: message"`;未知错误 → `"INTERNAL: <message>"`。

## 传输

| 传输            | 入口                             | 场景                                                                      |
| --------------- | -------------------------------- | ------------------------------------------------------------------------- |
| stdio           | `src/cli.ts`(`shipmate-mcp` bin) | 本地 Claude Code;读 `SHIPMATE_DATABASE_URL`(仓库根 .env)                  |
| HTTP streamable | `createMcpHttpHandler(db)`       | 由 web 包挂载到 `/api/mcp` 路由;每会话独立 server/transport,JSON 响应模式 |

### Claude Code 接入(stdio)

`.mcp.json` / `claude_desktop_config.json` 示例:

```json
{
  "mcpServers": {
    "shipmate": {
      "command": "node",
      "args": ["--import", "tsx", "packages/mcp/src/cli.ts"],
      "env": { "SHIPMATE_DATABASE_URL": "postgresql://user:pass@host:port/db" }
    }
  }
}
```

> `.env` 存在时命令内无需重复传 `SHIPMATE_DATABASE_URL`(cli 会 `loadDotEnv`)。

### HTTP 端点

由 web 包(Plan 3)将 `createMcpHttpHandler(db)` 挂载到 `/api/mcp`(POST/GET/DELETE)。客户端流程:`initialize`(携带 `clientInfo.name` 决定审计 actor)→ `notifications/initialized` → 正常调用;响应为 JSON 模式,会话由 `mcp-session-id` 头管理,`DELETE` 关闭会话。

## 工具清单(35 个)

### 分组(5)

| 工具           | 入参                              | 说明                                        |
| -------------- | --------------------------------- | ------------------------------------------- |
| `create_group` | name, description?                | 创建项目分组                                |
| `update_group` | id, name?/description?/sortOrder? | 修改分组                                    |
| `delete_group` | id                                | 删除空分组;组内仍有项目报 `GROUP_NOT_EMPTY` |
| `list_groups`  | —                                 | 全部分组,含 projectCount                    |
| `get_group`    | id                                | 分组 + 组内项目及各自需求完成度             |

### 项目(5)

| 工具             | 入参                                             | 说明                                                       |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `create_project` | groupId?, name, description?                     | 创建项目(可归属分组)                                       |
| `update_project` | id, name?/description?/status?(active\|archived) | 修改项目                                                   |
| `list_projects`  | groupId?(可 null = 仅无分组项目)                 | 项目数组                                                   |
| `get_project`    | id                                               | 项目概要:完成度 + 需求点状态分布 + 超期数 + 最近 20 条变更 |
| `delete_project` | id                                               | 永久删除项目及其全部需求数据(级联),变更审计保留——危险操作  |

### 需求(3)

| 工具                 | 入参                                                            | 说明                                             |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `create_requirement` | projectId, title, summary?, priority?, planStartAt?, planDueAt? | 创建需求(draft/P2 默认;时间为 Unix 毫秒)         |
| `update_requirement` | id, title?/summary?/status?/priority?/planStartAt?/planDueAt?   | 修改需求;状态变化记 status_change                |
| `list_requirements`  | projectId, status?/priority?/overdue?                           | 需求数组,含 overdue/overdueDays/dueSoon 计算字段 |

### 需求点(5)

| 工具                           | 入参                               | 说明                                                                             |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `list_requirement_points`      | requirementId?/projectId?/status?  | 需求点数组                                                                       |
| `get_requirement_point`        | id                                 | 点 + 关联任务 + 完整变更历史 + evidences 溯源                                    |
| `update_requirement_point`     | id, title?/description?, reason?   | 实质修改:version+1、状态回退、任务联动 needs_reassessment;返回 affectedTaskCount |
| `set_requirement_point_status` | id, action(confirm/start/complete) | 状态机流转                                                                       |
| `confirm_requirement_point`    | id                                 | confirm 语义化别名                                                               |

### 任务(5)

| 工具                        | 入参                                                | 说明                                  |
| --------------------------- | --------------------------------------------------- | ------------------------------------- |
| `create_task`               | requirementPointId, title, description?, sortOrder? | 创建任务(pending)                     |
| `update_task`               | id, title?/description?/sortOrder?                  | 修改任务                              |
| `set_task_status`           | id, action(start/complete)                          | 状态机流转                            |
| `list_tasks`                | requirementPointId?/projectId?/status?              | 任务数组                              |
| `confirm_task_reassessment` | id                                                  | 重估确认:needs_reassessment → pending |

### 素材与分析(9)

| 工具                  | 入参                                                              | 说明                                                                                                  |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `create_analysis_run` | projectId, title?                                                 | 创建分析批次(pending,标题缺省自动命名)                                                                |
| `add_material`        | runId, type(paste_text\|screenshot_text\|doc), rawContent, title? | 向批次添加素材(素材必属批次)                                                                          |
| `list_materials`      | runId                                                             | 批次内全部素材                                                                                        |
| `get_material`        | runId, id                                                         | 单个素材                                                                                              |
| `start_analysis`      | runId                                                             | 汇集素材调 LLM 产出草稿暂存批次;**同步执行,耗时取决于模型**                                           |
| `apply_analysis_run`  | runId, selectedRequirements?, selectedSupplements?, decisions?    | 草稿事务落库(默认全选);相悖块必须裁决(use_new/use_old/keep_both),重复块处置(merge/create_anyway/skip) |
| `revise_draft`        | runId, blockIndex, pointIndex?, annotation, keepEvidences?        | 按批注让 AI 重写草稿块/点,返回修订后内容;修订前快照自动入审计,**同步执行,耗时取决于模型**             |
| `list_analysis_runs`  | projectId, status?                                                | 批次数组,含素材数与草稿统计                                                                           |
| `get_analysis_run`    | id                                                                | 批次 + 全部素材 + 草稿产出                                                                            |

### 审计与进度(3)

| 工具                       | 入参                               | 说明                                              |
| -------------------------- | ---------------------------------- | ------------------------------------------------- |
| `get_change_log`           | entityType(7 值), entityId, limit? | 单实体变更时间线(倒序)                            |
| `get_project_audit_report` | projectId                          | 时间线 + actor 分布 + 实体类型分布 + 每日计数趋势 |
| `get_project_progress`     | projectId                          | 项目概要即进度:完成度/点分布/超期数/最近变更      |

## 开发

```bash
pnpm -C packages/mcp test        # vitest,连真实 PostgreSQL(SHIPMATE_TEST_DATABASE_URL)
pnpm -C packages/mcp typecheck
```

工具 handler 统一经 `withCore(core, actor, fn)` 包装:入参透传 core,成功经 `ok()` 序列化为 JSON 文本,`DomainError`/未知错误经 `fail()` 映射为 isError。
