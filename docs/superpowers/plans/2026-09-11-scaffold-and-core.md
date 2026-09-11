# ShipMate 脚手架 + core 包 实施计划(Plan 1/3,PostgreSQL 版)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 pnpm monorepo,并完整实现 `@shipmate/core`——领域模型(9 张表)、状态机、实质修改联动事务、审计变更链、AI 素材分析编排(含冲突三分类应用)。

**Architecture:** core 是纯领域包,不依赖任何框架;PostgreSQL 连接经 drizzle-orm(node-postgres)注入,所有服务 **async API**。每个写操作在事务内写 change_logs。web/mcp 后续只做薄门面。

**Tech Stack:** TypeScript 5 strict + ESM(nodenext)、pnpm workspace、PostgreSQL、drizzle-orm + node-postgres(pg)、uuid v7、zod、vitest。

**Spec:** `docs/design.md`(唯一真相源)。本计划实现其 §2 工程约定、§3 领域模型、§4 状态机、§5 核心规则、§6 服务接口、§7 错误模型、§9 AI 分析流程、§10 配置、§11 测试策略(core 部分)。§8 MCP 工具面属 Plan 2,§14 页面交互属 Plan 3。

**数据库决策(D7,2026-09-11):** PostgreSQL 替代 SQLite。真实连接串已写入仓库根 `.env`(`SHIPMATE_DATABASE_URL` / `SHIPMATE_TEST_DATABASE_URL`),`.gitignore` 已挡 `.env`——**任何真实凭据禁止写入任何被 git 跟踪的文件**(spec、代码、本计划均不得出现)。

## Global Constraints(每个任务默认遵守)

- Node >= 22 LTS,pnpm >= 9。所有命令在仓库根 `C:/Projects/Maxon-Projects/shipmate` 下执行。
- 全仓库 ESM(`"type": "module"`),tsconfig `module`/`moduleResolution` 均为 `nodenext` → **包内相对导入必须带 `.js` 后缀**(如 `from '../db/id.js'`,即使源文件是 `.ts`)。
- TypeScript `strict: true`。
- core 依赖白名单:`drizzle-orm`、`pg`、`uuid`、`zod`;devDependencies:`drizzle-kit`、`vitest`、`tsx`、`@types/pg`。**禁止**引入 next / React / @modelcontextprotocol-sdk / Express / better-sqlite3 等。
- 依赖方向:`web → core`、`mcp → core`;core 不依赖仓库内其他包。
- **API 全异步**:所有 core 服务方法返回 `Promise`;drizzle 查询直接 `await`(node-postgres 驱动**没有** `.get()/.all()/.run()` 尾方法);事务写法 `this.db.transaction(async (tx) => { ... })`。
- 所有表主键 `id: text`,值为 UUID v7;时间戳列一律 `bigint`(drizzle `{ mode: 'number' }`),值为 Unix 毫秒 `Date.now()`(int4 放不下毫秒时间戳);JSON 列一律 `jsonb`;`sort_order`/`version` 用 `integer`。
- 所有写操作必须携带 `actor: Actor`(`'human' | 'ai:analysis' | \`mcp:${string}\``),并写 change_logs(change_logs 自身写入不再记录)。
- 错误一律抛 `DomainError`(带 code),禁止裸 `throw new Error(...)` 泄漏到服务边界之外。
- SQLite 的 JSON 列默认值问题不存在,但服务层写行时仍**显式给** `[]` / `null`,不依赖数据库默认值。
- 测试连接 `SHIPMATE_TEST_DATABASE_URL`(来自仓库根 `.env`);测试用**事务回滚隔离**(见 Task 3 test-utils),禁止 TRUNCATE/DELETE 清表。单文件:`pnpm -C packages/core test src/...`,全量:`pnpm -C packages/core test`,类型:`pnpm -C packages/core typecheck`。
- commit message 用中文,遵循 conventional commits 前缀(feat/test/chore/docs),**禁止出现 `Co-Authored-By: Claude` 等 AI 协作署名**。
- 文件路径分隔符一律用正斜杠 `/`。
- 测试等待远程库(每次查询约几十毫秒),`expect` 前的查询都要 `await`,不得引入 sleep。

---

## File Structure(本计划全部产出)

```
shipmate/
├── package.json                  # 根:workspace scripts + lint/format 工具链
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js              # ESLint 9 flat config
├── .prettierrc.json
├── .gitignore                    # 已存在(Task 1 核对补充)
├── .env                          # 已存在,真实凭据,不进 git
├── .env.example                  # 已存在,占位模板,进 git
├── packages/core/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── drizzle.config.ts
│   ├── drizzle/                  # drizzle-kit 生成的 migrations(git 跟踪)
│   ├── README.md
│   └── src/
│       ├── index.ts              # createCore 门面 + 全量导出
│       ├── errors.ts             # DomainError
│       ├── types.ts              # Actor 等
│       ├── db/
│       │   ├── schema.ts         # 9 张表(pg-core)+ 行类型
│       │   ├── database.ts       # createDatabase(pg Pool + migrate)
│       │   ├── test-utils.ts     # withDb 事务回滚测试工厂
│       │   └── id.ts             # UUID v7
│       ├── llm/
│       │   ├── client.ts         # OpenAI 兼容 /chat/completions
│       │   ├── schema.ts         # 分析产出的 zod schema + 草稿类型
│       │   ├── prompt.ts         # 系统/用户 prompt 构建
│       │   └── prompt-types.ts   # ExistingRequirementDigest
│       └── services/
│           ├── change-log.ts     # writeChangeLog(事务内复用)
│           ├── group.service.ts
│           ├── project.service.ts
│           ├── requirement.service.ts
│           ├── requirement-point.service.ts
│           ├── task.service.ts
│           ├── audit.service.ts
│           ├── settings.service.ts
│           └── analysis.service.ts
└── (对应 *.test.ts 与源文件同目录)
```

---

### Task 1: Monorepo 脚手架与 core 包骨架

**Files:**

- Create: `pnpm-workspace.yaml`
- Create: `package.json`(根,覆盖已有的最小占位)
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Modify: `.gitignore`(已存在,核对条目)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**

- Consumes: 无(起点)。
- Produces: 可运行的 workspace;`@shipmate/core` 包名;`pnpm -C packages/core test` / `typecheck` 命令;根 `pnpm lint` / `format`。

- [ ] **Step 1: 写 workspace 与根配置文件**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

`package.json`(根):

```json
{
  "name": "shipmate",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "eslint": "^9.15.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.15.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  }
}
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/drizzle/**', 'data/**'] },
  {
    files: ['packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
  },
);
```

`.prettierrc.json`:

```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`.gitignore`(已存在于仓库根,核对包含以下条目,缺则补):

```
node_modules/
dist/
data/
.env
.env.local
*.tsbuildinfo
```

- [ ] **Step 2: 写 core 包骨架**

`packages/core/package.json`:

```json
{
  "name": "@shipmate/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.3",
    "pg": "^8.13.1",
    "uuid": "^11.0.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.28.1",
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

注:drizzle-orm 与 drizzle-kit 若安装时报版本不配套,按 drizzle 官方配套表同时升到相互兼容的最新版,并保持此处记录同步。

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts", "drizzle.config.ts", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
```

(测试连远程 PG,超时放宽到 30s,防网络抖动误报。)

`packages/core/src/index.ts`(临时冒烟导出,后续任务逐步扩充):

```ts
export const CORE_VERSION = '0.1.0' as const;
```

- [ ] **Step 3: 写冒烟测试**

`packages/core/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './index.js';

describe('core 包骨架', () => {
  it('导出版本号', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 4: 安装依赖并验证测试管道**

Run: `pnpm install`
Expected: 安装成功(pg 有预编译二进制,无需本地编译)。

Run: `pnpm -C packages/core test`
Expected: PASS,1 个用例。

Run: `pnpm -C packages/core typecheck && pnpm lint`
Expected: 均无错误。

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json eslint.config.js .prettierrc.json .gitignore .env.example packages/core
git commit -m "chore: pnpm monorepo 脚手架与 @shipmate/core 包骨架"
```

(注意:确认 `.env` 不在 `git status` 中——`.gitignore` 已挡;绝不 add `.env`。)

---

### Task 2: 错误模型 + Actor + UUID v7

**Files:**

- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/db/id.ts`
- Test: `packages/core/src/errors.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces(后续所有任务使用):
  - `class DomainError extends Error`,构造 `(code: DomainErrorCode, message: string, details?: unknown)`,字段 `code` / `details`。
  - `type DomainErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INVALID_STATUS_TRANSITION' | 'GROUP_NOT_EMPTY' | 'PROJECT_HAS_NO_REQUIREMENTS' | 'LLM_ERROR' | 'LLM_SCHEMA_MISMATCH' | 'INTERNAL'`(spec §7 全集)。
  - `type Actor = 'human' | 'ai:analysis' | \`mcp:${string}\``。
  - `newId(): string`(UUID v7)。

- [ ] **Step 1: 写失败测试**

`packages/core/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import { newId } from './db/id.js';
import type { Actor } from './types.js';

describe('DomainError', () => {
  it('携带 code 与 details', () => {
    const e = new DomainError('GROUP_NOT_EMPTY', '分组下仍有项目', { projectId: 'p1' });
    expect(e.code).toBe('GROUP_NOT_EMPTY');
    expect(e.details).toEqual({ projectId: 'p1' });
    expect(e.message).toBe('分组下仍有项目');
    expect(e.name).toBe('DomainError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('newId', () => {
  it('生成 UUID v7 且唯一', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('Actor', () => {
  it('接受三种来源', () => {
    const actors: Actor[] = ['human', 'ai:analysis', 'mcp:claude-code'];
    expect(actors).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/errors.test.ts`
Expected: FAIL(`Cannot find module './errors.js'`)。

- [ ] **Step 3: 实现**

`packages/core/src/errors.ts`:

```ts
/** spec §7 错误模型:core 层唯一错误通道,web/mcp 门面按 code 各自映射 */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_STATUS_TRANSITION'
  | 'GROUP_NOT_EMPTY'
  | 'PROJECT_HAS_NO_REQUIREMENTS'
  | 'LLM_ERROR'
  | 'LLM_SCHEMA_MISMATCH'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
```

`packages/core/src/types.ts`:

```ts
/**
 * spec §5.1 actor 全记录:
 * - human:Web UI 操作(web 门面固定传)
 * - mcp:<agent名>:agent 经 MCP 操作
 * - ai:analysis:core 内部分析编排
 */
export type Actor = 'human' | 'ai:analysis' | `mcp:${string}`;
```

`packages/core/src/db/id.ts`:

```ts
import { v7 as uuidv7 } from 'uuid';

/** 所有表主键生成器:UUID v7,时间有序(spec D1) */
export const newId = (): string => uuidv7();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/errors.test.ts && pnpm -C packages/core typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/types.ts packages/core/src/db/id.ts packages/core/src/errors.test.ts
git commit -m "feat(core): DomainError 错误模型、Actor 类型与 UUID v7 主键生成"
```

---

### Task 3: 数据库 schema(9 张表,PostgreSQL)与连接工厂 + 测试工厂

**Files:**

- Create: `packages/core/src/db/schema.ts`
- Create: `packages/core/src/db/database.ts`
- Create: `packages/core/src/db/test-utils.ts`
- Create: `packages/core/drizzle.config.ts`
- Create: `packages/core/drizzle/`(drizzle-kit 生成,git 跟踪)
- Test: `packages/core/src/db/database.test.ts`

**Interfaces:**

- Consumes: `newId`;仓库根 `.env` 的 `SHIPMATE_TEST_DATABASE_URL`。
- Produces(后续所有任务使用):
  - drizzle 表对象(pg-core):`groups / projects / analysisRuns / materials / requirements / requirementPoints / tasks / changeLogs / settings`。
  - 行类型:`GroupRow / ProjectRow / AnalysisRunRow / MaterialRow / RequirementRow / RequirementPointRow / TaskRow / ChangeLogRow / SettingRow`(均 `typeof x.$inferSelect`)。
  - 值对象类型:`Evidence { material_id: string; quote: string }`、`PointRelation { type: 'duplicate'|'conflict'; point_id: string; resolved?: boolean }`。
  - `type ShipmateDb = NodePgDatabase<typeof schema>`、`type ShipmateTx`(事务句柄,drizzle 自动 savepoint 嵌套)。
  - `async createDatabase(connectionString: string): Promise<ShipmateDb>`(Pool + drizzle + migrate,幂等)。
  - `async withDb(fn: (db: ShipmateDb) => Promise<void>): Promise<void>`(测试专用:外层事务包裹 `fn`,末尾强制 ROLLBACK,零残留;`fn` 内拿到的 db 传给任何 service 都行,service 内部事务自动变为 SAVEPOINT)。
  - 相对 spec §3.2 的一处补齐:`analysis_runs` 增加可空列 `draft_result`(jsonb)——spec §9 要求草稿"不落业务表",暂存于 Run 自身;执行本任务时同步在 `docs/design.md` §3.2 表格补一行。

- [ ] **Step 1: 写失败测试**

`packages/core/src/db/database.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabase, withDb } from './database.js';
import { groups, projects } from './schema.js';
import { newId } from './id.js';

const TEST_URL = process.env.SHIPMATE_TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('缺少 SHIPMATE_TEST_DATABASE_URL(见仓库根 .env)');

describe('createDatabase', () => {
  it('migrate 幂等建齐 9 张表', async () => {
    const db = await createDatabase(TEST_URL!);
    const rows = (await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )) as unknown as { rows: { tablename: string }[] };
    const names = rows.rows.map((r) => r.tablename);
    for (const t of [
      'groups',
      'projects',
      'analysis_runs',
      'materials',
      'requirements',
      'requirement_points',
      'tasks',
      'change_logs',
      'settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('外键约束生效', async () => {
    const db = await createDatabase(TEST_URL!);
    const now = Date.now();
    await expect(
      db.insert(projects).values({
        id: newId(),
        groupId: '不存在的组',
        name: 'p',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('withDb(事务回滚隔离)', () => {
  it('事务内写入可见,回滚后零残留', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      await db
        .insert(groups)
        .values({ id: newId(), name: '测试分组', sortOrder: 0, createdAt: now, updatedAt: now });
      const rows = await db.select().from(groups);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('测试分组');
    });
    // 回滚后必须查不到
    const db = await createDatabase(TEST_URL!);
    expect(await db.select().from(groups)).toHaveLength(0);
  });

  it('service 内部事务在外层事务中变为 SAVEPOINT,同样被回滚', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        const now = Date.now();
        await tx
          .insert(groups)
          .values({ id: newId(), name: '嵌套写入', sortOrder: 0, createdAt: now, updatedAt: now });
      });
      expect(await db.select().from(groups)).toHaveLength(1);
    });
    const db = await createDatabase(TEST_URL!);
    expect(await db.select().from(groups)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/db/database.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 schema**

`packages/core/src/db/schema.ts`(完整,spec §3.0-3.8 逐表):

```ts
import { bigint, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/** 置信度依据:AI 引用的素材原文段落(spec §3.5) */
export interface Evidence {
  material_id: string;
  quote: string;
}

/** 需求点冲突关系(spec §3.5 relations) */
export interface PointRelation {
  type: 'duplicate' | 'conflict';
  point_id: string;
  resolved?: boolean;
}

// §3.0 groups
export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.1 projects
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  groupId: text('group_id').references(() => groups.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'archived'] }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.2 analysis_runs;draft_result 为计划补齐列(草稿暂存,不落业务表)
export const analysisRuns = pgTable('analysis_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title'),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
  actor: text('actor').notNull(),
  draftResult: jsonb('draft_result'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
});

// §3.3 materials
export const materials = pgTable('materials', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  analysisRunId: text('analysis_run_id')
    .notNull()
    .references(() => analysisRuns.id),
  type: text('type', { enum: ['paste_text', 'screenshot_text', 'doc'] }).notNull(),
  title: text('title'),
  rawContent: text('raw_content').notNull(),
  actor: text('actor').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// §3.4 requirements
export const requirements = pgTable('requirements', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  summary: text('summary'),
  status: text('status', { enum: ['draft', 'confirmed', 'done', 'archived'] }).notNull(),
  priority: text('priority', { enum: ['P0', 'P1', 'P2', 'P3'] }).notNull(),
  planStartAt: bigint('plan_start_at', { mode: 'number' }),
  planDueAt: bigint('plan_due_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// §3.5 requirement_points(jsonb 列,服务层写行时显式给值)
export const requirementPoints = pgTable(
  'requirement_points',
  {
    id: text('id').primaryKey(),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => requirements.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['draft', 'confirmed', 'developing', 'done'] }).notNull(),
    version: integer('version').notNull(),
    sourceMaterialIds: jsonb('source_material_ids').$type<string[]>(),
    evidences: jsonb('evidences').$type<Evidence[]>(),
    origin: text('origin', { enum: ['analysis', 'supplement', 'manual'] }).notNull(),
    relations: jsonb('relations').$type<PointRelation[]>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_points_req').on(t.requirementId),
    index('idx_points_req_status').on(t.requirementId, t.status),
  ],
);

// §3.6 tasks
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    requirementPointId: text('requirement_point_id')
      .notNull()
      .references(() => requirementPoints.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', {
      enum: ['pending', 'in_progress', 'done', 'needs_reassessment'],
    }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    commitRefs: jsonb('commit_refs').$type<string[]>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_tasks_point').on(t.requirementPointId),
    index('idx_tasks_point_sort').on(t.requirementPointId, t.sortOrder),
  ],
);

// §3.7 change_logs;change_type 在 spec 5 值基础上补 'delete'(删除实体时的快照留存,已同步 design.md §3.7)
export const changeLogs = pgTable(
  'change_logs',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type', {
      enum: [
        'group',
        'project',
        'analysis_run',
        'material',
        'requirement',
        'requirement_point',
        'task',
      ],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    changeType: text('change_type', {
      enum: ['create', 'update', 'status_change', 'linkage_impact', 'discard', 'delete'],
    }).notNull(),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot').notNull(),
    reason: text('reason'),
    actor: text('actor').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('idx_logs_entity').on(t.entityType, t.entityId, t.createdAt),
    index('idx_logs_entity_id').on(t.entityId),
  ],
);

// §3.8 settings(键值;配置类写入不记 change_logs——entity_type 枚举未含 settings,属有意为之)
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// ---- 行类型导出(服务层统一使用)----
export type GroupRow = typeof groups.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type AnalysisRunRow = typeof analysisRuns.$inferSelect;
export type MaterialRow = typeof materials.$inferSelect;
export type RequirementRow = typeof requirements.$inferSelect;
export type RequirementPointRow = typeof requirementPoints.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ChangeLogRow = typeof changeLogs.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;

export type EntityType = (typeof changeLogs.$inferSelect)['entityType'];
export type ChangeType = (typeof changeLogs.$inferSelect)['changeType'];
```

同步修改 `docs/design.md` §3.7 的 change_type 枚举说明:在 `discard`(作废 draft 时的快照留存)后追加 `/ delete`(实体删除时的快照留存)。

- [ ] **Step 4: 实现连接工厂、测试工厂与 drizzle 配置**

`packages/core/src/db/database.ts`:

```ts
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type ShipmateDb = NodePgDatabase<typeof schema>;
export type ShipmateTx = Parameters<Parameters<ShipmateDb['transaction']>[0]>[0];
export { schema };

/** drizzle/ 目录位置:src/db 与 dist/db 的上两级都是包根,两种运行形态下均成立 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * 创建数据库连接:pg Pool + drizzle + 执行 migrations(幂等,已应用的跳过)。
 * 时间戳列均为 bigint(Unix 毫秒),详见 schema.ts。
 */
export async function createDatabase(connectionString: string): Promise<ShipmateDb> {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// ---- 测试工厂:事务回滚隔离(禁止 TRUNCATE/DELETE 清表)----
const ROLLBACK_TOKEN = Symbol('shipmate-test-rollback');

let baseDb: ShipmateDb | null = null;

/** 读取仓库根 .env 的 KEY=VALUE(零依赖,仅填充未设置的变量;readFileSync 从 node:fs 顶部导入) */
export function loadDotEnv(): void {
  try {
    const raw = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

async function getBaseDb(): Promise<ShipmateDb> {
  if (!baseDb) {
    loadDotEnv();
    const url = process.env.SHIPMATE_TEST_DATABASE_URL;
    if (!url) throw new Error('缺少 SHIPMATE_TEST_DATABASE_URL(见仓库根 .env)');
    baseDb = await createDatabase(url);
  }
  return baseDb;
}

/**
 * 测试专用:外层事务包裹 fn,fn 正常返回后强制 ROLLBACK,零残留。
 * fn 内部再开事务(drizzle)自动降级为 SAVEPOINT,不影响隔离性。
 */
export async function withDb(fn: (db: ShipmateDb) => Promise<void>): Promise<void> {
  const db = await getBaseDb();
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as ShipmateDb);
      throw ROLLBACK_TOKEN;
    });
  } catch (e) {
    if (e !== ROLLBACK_TOKEN) throw e;
  }
}
```

`packages/core/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

- [ ] **Step 5: 生成 migrations 并跑测试**

Run: `pnpm -C packages/core db:generate`
Expected: `drizzle/` 下生成 migration SQL 与 meta 快照。**将生成物全部 git 跟踪**。

Run: `pnpm -C packages/core test src/db/database.test.ts`
Expected: PASS,4 个用例(首次运行会对 shipmate 库执行建表 migrate;后续幂等跳过)。
若连接失败:核对 `.env` 的 `SHIPMATE_TEST_DATABASE_URL`;确认远程 PG 端口可达(可用 `Test-NetConnection jumppad.aowu.tech -Port 21596`)。

Run: `pnpm -C packages/core typecheck`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db packages/core/drizzle packages/core/drizzle.config.ts docs/design.md
git commit -m "feat(core): PostgreSQL drizzle schema 9 张表、连接工厂与事务回滚测试工厂"
```

---

### Task 4: 变更日志 helper

**Files:**

- Create: `packages/core/src/services/change-log.ts`
- Test: `packages/core/src/services/change-log.test.ts`

**Interfaces:**

- Consumes: `ShipmateTx`、`changeLogs`、`newId`、`Actor`、`withDb`。
- Produces(所有写服务使用):
  - `interface ChangeLogInput { entityType: EntityType; entityId: string; changeType: ChangeType; before?: unknown; after: unknown; reason?: string; actor: Actor }`
  - `async writeChangeLog(tx: ShipmateTx, input: ChangeLogInput): Promise<void>` —— 在调用方事务内插入一条 change_log;`before` 缺省存 null;`reason` 缺省存 null。**所有调用点必须 await**。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/change-log.test.ts`(签名统一为 `writeChangeLog(tx, input)`):

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb } from '../db/database.js';
import { changeLogs } from '../db/schema.js';
import { writeChangeLog } from './change-log.js';

describe('writeChangeLog', () => {
  it('在事务内写入,缺省 before/reason 为 null', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        await writeChangeLog(tx, {
          entityType: 'project',
          entityId: 'p1',
          changeType: 'create',
          after: { id: 'p1', name: '项目一' },
          actor: 'human',
        });
      });
      const rows = await db.select().from(changeLogs).where(eq(changeLogs.entityId, 'p1'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'project',
        changeType: 'create',
        beforeSnapshot: null,
        reason: null,
        actor: 'human',
        afterSnapshot: { id: 'p1', name: '项目一' },
      });
    });
  });

  it('同一事务多次写入互相可见(供联动场景)', async () => {
    await withDb(async (db) => {
      await db.transaction(async (tx) => {
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: 't1',
          changeType: 'status_change',
          after: {},
          actor: 'mcp:claude-code',
        });
        const seen = await tx.select().from(changeLogs);
        expect(seen).toHaveLength(1);
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: 't1',
          changeType: 'linkage_impact',
          after: {},
          actor: 'human',
        });
      });
      expect(await db.select().from(changeLogs)).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/change-log.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/change-log.ts`:

```ts
import { changeLogs, type ChangeType, type EntityType } from '../db/schema.js';
import type { ShipmateTx } from '../db/database.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';

export interface ChangeLogInput {
  entityType: EntityType;
  entityId: string;
  changeType: ChangeType;
  before?: unknown;
  after: unknown;
  reason?: string;
  actor: Actor;
}

/**
 * 在调用方事务内写一条变更记录。
 * 规则(spec §3.7):所有业务表写操作都写 change_logs;change_logs 自身写入不再记录。
 * 必须在事务内调用 —— 单独写 log 而无业务变更没有意义。所有调用点必须 await。
 */
export async function writeChangeLog(tx: ShipmateTx, input: ChangeLogInput): Promise<void> {
  await tx.insert(changeLogs).values({
    id: newId(),
    entityType: input.entityType,
    entityId: input.entityId,
    changeType: input.changeType,
    beforeSnapshot: (input.before ?? null) as never,
    afterSnapshot: input.after as never,
    reason: input.reason ?? null,
    actor: input.actor,
    createdAt: Date.now(),
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/change-log.test.ts && pnpm -C packages/core typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/change-log.ts packages/core/src/services/change-log.test.ts
git commit -m "feat(core): 事务内变更日志 helper"
```

---

### Task 5: GroupService

**Files:**

- Create: `packages/core/src/services/group.service.ts`
- Test: `packages/core/src/services/group.service.test.ts`
- Modify: `packages/core/src/index.ts`(追加导出)

**Interfaces:**

- Consumes: `withDb`、`writeChangeLog`、`DomainError`、`newId`。
- Produces:
  - `type GroupWithCount = GroupRow & { projectCount: number }`
  - `type GroupProjectSummary = { project: ProjectRow; requirementTotal: number; requirementDone: number }`
  - `type GroupSummary = { group: GroupRow; projects: GroupProjectSummary[] }`
  - `class GroupService { constructor(db: ShipmateDb); async createGroup(input: { name: string; description?: string }, actor: Actor): Promise<GroupRow>; async updateGroup(id: string, input: { name?: string; description?: string; sortOrder?: number }, actor: Actor): Promise<GroupRow>; async deleteGroup(id: string, actor: Actor): Promise<void>; async getGroup(id: string): Promise<GroupSummary>; async listGroups(): Promise<GroupWithCount[]> }`
  - 错误:`getGroup/updateGroup/deleteGroup` 目标不存在抛 `NOT_FOUND`;`deleteGroup` 组内有项目抛 `GROUP_NOT_EMPTY`。
  - 写操作均记 change_logs:`create` / `update` / `delete`(delete 的 afterSnapshot 为 `{ deleted: true, id }`,before 为整行快照)。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/group.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, groups, projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { GroupService } from './group.service.js';

async function seedProject(db: ShipmateDb, groupId: string): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(projects)
    .values({ id: newId(), groupId, name: 'P', status: 'active', createdAt: now, updatedAt: now })
    .returning();
  return rows[0]!.id;
}

describe('GroupService', () => {
  it('createGroup:落库 + create 变更记录', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '华信事业部' }, 'human');
      expect(g.name).toBe('华信事业部');
      expect(g.sortOrder).toBe(0);
      const log = await db.select().from(changeLogs).where(eq(changeLogs.entityId, g.id));
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        entityType: 'group',
        changeType: 'create',
        actor: 'human',
        beforeSnapshot: null,
      });
    });
  });

  it('createGroup:name 为空抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      try {
        await svc.createGroup({ name: '' }, 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('updateGroup:部分字段更新 + before/after 快照', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '旧名' }, 'human');
      const after = await svc.updateGroup(g.id, { name: '新名', sortOrder: 5 }, 'human');
      expect(after).toMatchObject({ name: '新名', sortOrder: 5, description: null });
      const log = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'update'));
      expect(log).toHaveLength(1);
      expect(log[0]?.beforeSnapshot).toMatchObject({ name: '旧名', sortOrder: 0 });
    });
  });

  it('deleteGroup:组内有项目抛 GROUP_NOT_EMPTY,空组可删并记 delete', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: '有项目的组' }, 'human');
      await seedProject(db, g.id);
      try {
        await svc.deleteGroup(g.id, 'human');
        expect.unreachable('应当抛 GROUP_NOT_EMPTY');
      } catch (e) {
        expect((e as DomainError).code).toBe('GROUP_NOT_EMPTY');
      }

      const empty = await svc.createGroup({ name: '空组' }, 'human');
      await expect(svc.deleteGroup(empty.id, 'human')).resolves.toBeUndefined();
      expect(await db.select().from(groups).where(eq(groups.id, empty.id))).toHaveLength(0);
      const log = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'delete'));
      expect(log).toHaveLength(1);
      expect(log[0]?.entityType).toBe('group');
    });
  });

  it('getGroup:返回分组 + 组内项目完成度;不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      const g = await svc.createGroup({ name: 'G' }, 'human');
      await seedProject(db, g.id);
      const summary = await svc.getGroup(g.id);
      expect(summary.group.name).toBe('G');
      expect(summary.projects).toHaveLength(1);
      expect(summary.projects[0]).toMatchObject({ requirementTotal: 0, requirementDone: 0 });

      try {
        await svc.getGroup('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listGroups:含各组项目数', async () => {
    await withDb(async (db) => {
      const svc = new GroupService(db);
      await svc.createGroup({ name: 'G1' }, 'human');
      await svc.createGroup({ name: 'G2' }, 'human');
      const rows = await svc.listGroups();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.projectCount === 0)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/group.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/group.service.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { groups, projects, requirements, type GroupRow, type ProjectRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export interface CreateGroupInput {
  name: string;
  description?: string;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
  sortOrder?: number;
}

export type GroupWithCount = GroupRow & { projectCount: number };

export interface GroupProjectSummary {
  project: ProjectRow;
  requirementTotal: number;
  requirementDone: number;
}

export interface GroupSummary {
  group: GroupRow;
  projects: GroupProjectSummary[];
}

export class GroupService {
  constructor(private db: ShipmateDb) {}

  async createGroup(input: CreateGroupInput, actor: Actor): Promise<GroupRow> {
    const name = input.name?.trim();
    if (!name) throw new DomainError('VALIDATION_ERROR', '分组名不能为空');
    return this.db.transaction(async (tx) => {
      const now = Date.now();
      const rows = await tx
        .insert(groups)
        .values({
          id: newId(),
          name,
          description: input.description ?? null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateGroup(id: string, input: UpdateGroupInput, actor: Actor): Promise<GroupRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(groups).where(eq(groups.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
      const rows = await tx
        .update(groups)
        .set({
          name: input.name?.trim() || before.name,
          description: input.description !== undefined ? input.description : before.description,
          sortOrder: input.sortOrder !== undefined ? input.sortOrder : before.sortOrder,
          updatedAt: Date.now(),
        })
        .where(eq(groups.id, id))
        .returning();
      const after = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: id,
        changeType: 'update',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async deleteGroup(id: string, actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = (await tx.select().from(groups).where(eq(groups.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
      const owned = await tx.select().from(projects).where(eq(projects.groupId, id));
      if (owned.length > 0) {
        throw new DomainError(
          'GROUP_NOT_EMPTY',
          `分组「${before.name}」下仍有 ${owned.length} 个项目,禁止删除`,
        );
      }
      await tx.delete(groups).where(eq(groups.id, id));
      await writeChangeLog(tx, {
        entityType: 'group',
        entityId: id,
        changeType: 'delete',
        before,
        after: { deleted: true, id },
        actor,
      });
    });
  }

  async getGroup(id: string): Promise<GroupSummary> {
    const group = (await this.db.select().from(groups).where(eq(groups.id, id)))[0];
    if (!group) throw new DomainError('NOT_FOUND', `分组 ${id} 不存在`);
    const projs = await this.db.select().from(projects).where(eq(projects.groupId, id));
    const projectSummaries = await Promise.all(
      projs.map(async (p) => {
        const reqs = await this.db
          .select()
          .from(requirements)
          .where(eq(requirements.projectId, p.id));
        return {
          project: p,
          requirementTotal: reqs.length,
          requirementDone: reqs.filter((r) => r.status === 'done').length,
        };
      }),
    );
    return { group, projects: projectSummaries };
  }

  async listGroups(): Promise<GroupWithCount[]> {
    const rows = await this.db.select().from(groups);
    const allProjects = await this.db.select().from(projects);
    return rows.map((g) => ({
      ...g,
      projectCount: allProjects.filter((p) => p.groupId === g.id).length,
    }));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/group.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,6 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 改为:

```ts
export const CORE_VERSION = '0.1.0' as const;

export { DomainError, type DomainErrorCode } from './errors.js';
export type { Actor } from './types.js';
export { newId } from './db/id.js';
export { createDatabase, withDb, schema, type ShipmateDb, type ShipmateTx } from './db/database.js';
export * from './db/schema.js';
export {
  GroupService,
  type CreateGroupInput,
  type GroupSummary,
  type GroupWithCount,
} from './services/group.service.js';
```

```bash
git add packages/core/src/services/group.service.ts packages/core/src/services/group.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): GroupService 分组服务(GROUP_NOT_EMPTY 守卫与审计)"
```

---

### Task 6: ProjectService

**Files:**

- Create: `packages/core/src/services/project.service.ts`
- Test: `packages/core/src/services/project.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `writeChangeLog`、`DomainError`、`projects/groups/requirements/requirementPoints/changeLogs` 表、`newId`、本地超期判断:本任务内联实现过渡函数 `isOverdue(row: RequirementRow, now?: number): boolean`(status ∈ {draft, confirmed} 且 planDueAt < now;Task 7 提供完整版 `computeOverdue` 后删除内联版改用导入)。
- Produces:
  - `type ProjectSummary = { project: ProjectRow; requirementTotal: number; requirementDone: number; overdueRequirementCount: number; pointStatusCounts: Record<'draft'|'confirmed'|'developing'|'done', number>; recentChanges: ChangeLogRow[] }`(recentChanges 限 20 条,按 createdAt 倒序)
  - `class ProjectService { constructor(db: ShipmateDb); async createProject(input: { groupId?: string; name: string; description?: string }, actor: Actor): Promise<ProjectRow>; async updateProject(id: string, input: { name?: string; description?: string; status?: 'active'|'archived' }, actor: Actor): Promise<ProjectRow>; async getProject(id: string): Promise<ProjectSummary>; async listProjects(filter?: { groupId?: string | null }): Promise<ProjectRow[]> }`
  - 错误:目标不存在 `NOT_FOUND`;`groupId` 指向不存在的分组 `NOT_FOUND`。
  - 变更记录:status 变化记 `status_change`,名称等其余字段变化记 `update`;两者同时发生则两条都写。
  - `listProjects({ groupId: null })` 查未分组项目;不传 filter 返回全部。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/project.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, requirementPoints, requirements, groups } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { ProjectService } from './project.service.js';

async function seedGroup(db: ShipmateDb): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(groups)
    .values({ id: newId(), name: 'G', sortOrder: 0, createdAt: now, updatedAt: now })
    .returning();
  return rows[0]!.id;
}

describe('ProjectService', () => {
  it('createProject:入组/不入组均可;groupId 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const gid = await seedGroup(db);
      const p1 = await svc.createProject({ groupId: gid, name: '已入组项目' }, 'human');
      const p2 = await svc.createProject({ name: '未入组项目' }, 'human');
      expect(p1.groupId).toBe(gid);
      expect(p2.groupId).toBeNull();
      try {
        await svc.createProject({ groupId: 'missing', name: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('updateProject:status 变更写 status_change,名称变更写 update', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '项目A' }, 'human');
      await svc.updateProject(p.id, { name: '项目A2' }, 'human');
      await svc.updateProject(p.id, { status: 'archived' }, 'human');
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.entityId, p.id));
      const types = logs.map((l) => l.changeType);
      expect(types).toContain('create');
      expect(types).toContain('update');
      expect(types).toContain('status_change');
    });
  });

  it('getProject:完成度/点状态分布/超期数/最近变更', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const p = await svc.createProject({ name: '项目B' }, 'human');
      const now = Date.now();
      const day = 86_400_000;
      const mkReq = (status: 'draft' | 'confirmed' | 'done', planDueAt?: number) =>
        db
          .insert(requirements)
          .values({
            id: newId(),
            projectId: p.id,
            title: `R-${Math.random()}`,
            status,
            priority: 'P2',
            planDueAt: planDueAt ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      const doneReq = await mkReq('done');
      await mkReq('confirmed', now - 10 * day); // 超期
      await mkReq('draft');
      const now2 = Date.now();
      await db.insert(requirementPoints).values([
        {
          id: newId(),
          requirementId: doneReq[0]!.id,
          title: 't1',
          status: 'done',
          version: 1,
          sourceMaterialIds: [],
          evidences: [],
          origin: 'manual',
          createdAt: now2,
          updatedAt: now2,
        },
        {
          id: newId(),
          requirementId: doneReq[0]!.id,
          title: 't2',
          status: 'developing',
          version: 1,
          sourceMaterialIds: [],
          evidences: [],
          origin: 'manual',
          createdAt: now2,
          updatedAt: now2,
        },
      ]);

      const s = await svc.getProject(p.id);
      expect(s.requirementTotal).toBe(3);
      expect(s.requirementDone).toBe(1);
      expect(s.overdueRequirementCount).toBe(1);
      expect(s.pointStatusCounts).toEqual({ draft: 0, confirmed: 0, developing: 1, done: 1 });
      expect(s.recentChanges.length).toBeGreaterThan(0);

      try {
        await svc.getProject('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listProjects:全部 / 按组 / 未分组(null)', async () => {
    await withDb(async (db) => {
      const svc = new ProjectService(db);
      const gid = await seedGroup(db);
      await svc.createProject({ groupId: gid, name: '在组内' }, 'human');
      await svc.createProject({ name: '不在组内' }, 'human');
      expect(await svc.listProjects()).toHaveLength(2);
      expect(await svc.listProjects({ groupId: gid })).toHaveLength(1);
      expect(await svc.listProjects({ groupId: null })).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/project.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/project.service.ts`:

```ts
import { desc, eq, inArray, isNull } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  groups,
  projects,
  requirementPoints,
  requirements,
  type ChangeLogRow,
  type ProjectRow,
  type RequirementRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export interface CreateProjectInput {
  groupId?: string;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: 'active' | 'archived';
}

export type PointStatusKey = 'draft' | 'confirmed' | 'developing' | 'done';

export interface ProjectSummary {
  project: ProjectRow;
  requirementTotal: number;
  requirementDone: number;
  overdueRequirementCount: number;
  pointStatusCounts: Record<PointStatusKey, number>;
  recentChanges: ChangeLogRow[];
}

/** 过渡版超期判断;Task 7 实现完整 computeOverdue 后,此函数删除并改用导入 */
function isOverdue(req: RequirementRow, now = Date.now()): boolean {
  if (!req.planDueAt) return false;
  if (req.status !== 'draft' && req.status !== 'confirmed') return false;
  return req.planDueAt < now;
}

export class ProjectService {
  constructor(private db: ShipmateDb) {}

  async createProject(input: CreateProjectInput, actor: Actor): Promise<ProjectRow> {
    const name = input.name?.trim();
    if (!name) throw new DomainError('VALIDATION_ERROR', '项目名不能为空');
    return this.db.transaction(async (tx) => {
      if (
        input.groupId !== undefined &&
        !(await tx.select().from(groups).where(eq(groups.id, input.groupId)))
      ) {
        throw new DomainError('NOT_FOUND', `分组 ${input.groupId} 不存在`);
      }
      const now = Date.now();
      const rows = await tx
        .insert(projects)
        .values({
          id: newId(),
          groupId: input.groupId ?? null,
          name,
          description: input.description ?? null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'project',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateProject(id: string, input: UpdateProjectInput, actor: Actor): Promise<ProjectRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(projects).where(eq(projects.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `项目 ${id} 不存在`);

      const patch: Partial<typeof projects.$inferInsert> = { updatedAt: Date.now() };
      let nameChanged = false;
      let statusChanged = false;
      if (input.name !== undefined && input.name.trim() !== before.name) {
        if (!input.name.trim()) throw new DomainError('VALIDATION_ERROR', '项目名不能为空');
        patch.name = input.name.trim();
        nameChanged = true;
      }
      if (input.description !== undefined && input.description !== before.description) {
        patch.description = input.description;
      }
      if (input.status !== undefined && input.status !== before.status) {
        patch.status = input.status;
        statusChanged = true;
      }
      const after = (
        await tx.update(projects).set(patch).where(eq(projects.id, id)).returning()
      )[0]!;
      if (nameChanged) {
        await writeChangeLog(tx, {
          entityType: 'project',
          entityId: id,
          changeType: 'update',
          before,
          after,
          actor,
        });
      }
      if (statusChanged) {
        await writeChangeLog(tx, {
          entityType: 'project',
          entityId: id,
          changeType: 'status_change',
          before,
          after,
          actor,
        });
      }
      return after;
    });
  }

  async getProject(id: string): Promise<ProjectSummary> {
    const project = (await this.db.select().from(projects).where(eq(projects.id, id)))[0];
    if (!project) throw new DomainError('NOT_FOUND', `项目 ${id} 不存在`);

    const reqs = await this.db.select().from(requirements).where(eq(requirements.projectId, id));
    const reqIds = reqs.map((r) => r.id);
    const points = reqIds.length
      ? await this.db
          .select()
          .from(requirementPoints)
          .where(inArray(requirementPoints.requirementId, reqIds))
      : [];

    const pointStatusCounts: Record<PointStatusKey, number> = {
      draft: 0,
      confirmed: 0,
      developing: 0,
      done: 0,
    };
    for (const pt of points) pointStatusCounts[pt.status] += 1;

    const entityIds = [id, ...reqIds, ...points.map((pt) => pt.id)];
    const recentChanges = entityIds.length
      ? await this.db
          .select()
          .from(changeLogs)
          .where(inArray(changeLogs.entityId, entityIds))
          .orderBy(desc(changeLogs.createdAt))
          .limit(20)
      : [];

    return {
      project,
      requirementTotal: reqs.length,
      requirementDone: reqs.filter((r) => r.status === 'done').length,
      overdueRequirementCount: reqs.filter((r) => isOverdue(r)).length,
      pointStatusCounts,
      recentChanges,
    };
  }

  async listProjects(filter?: { groupId?: string | null }): Promise<ProjectRow[]> {
    if (filter?.groupId === null) {
      return this.db.select().from(projects).where(isNull(projects.groupId));
    }
    if (filter?.groupId !== undefined) {
      return this.db.select().from(projects).where(eq(projects.groupId, filter.groupId));
    }
    return this.db.select().from(projects);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/project.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,4 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export {
  ProjectService,
  type CreateProjectInput,
  type ProjectSummary,
} from './services/project.service.js';
```

```bash
git add packages/core/src/services/project.service.ts packages/core/src/services/project.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): ProjectService 项目服务与概要聚合"
```

---

### Task 7: RequirementService(含超期/临期计算)

**Files:**

- Create: `packages/core/src/services/requirement.service.ts`
- Test: `packages/core/src/services/requirement.service.test.ts`
- Modify: `packages/core/src/services/project.service.ts`(删除过渡 `isOverdue`,改导入 `computeOverdue`)
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `writeChangeLog`、`DomainError`、`requirements` 表、`newId`。
- Produces:
  - `function computeOverdue(req: RequirementRow, now?: number): { overdue: boolean; overdueDays: number; dueSoon: boolean }`(spec §4.3:status ∈ {draft, confirmed} 才参与;planDueAt < now → overdue=true 且 overdueDays = 向下取整天数;0 ≤ 剩余天数 ≤ 3 → dueSoon=true;未设 planDueAt 全 false)
  - `type RequirementWithOverdue = RequirementRow & { overdue: boolean; overdueDays: number; dueSoon: boolean }`
  - `class RequirementService { constructor(db: ShipmateDb); async createRequirement(input: { projectId: string; title: string; summary?: string; priority?: 'P0'|'P1'|'P2'|'P3'; planStartAt?: number; planDueAt?: number }, actor: Actor): Promise<RequirementRow>; async updateRequirement(id: string, input: { title?: string; summary?: string; status?: 'draft'|'confirmed'|'done'|'archived'; priority?: 'P0'|'P1'|'P2'|'P3'; planStartAt?: number | null; planDueAt?: number | null }, actor: Actor): Promise<RequirementRow>; async listRequirements(projectId: string, filter?: { status?: string; priority?: string; overdue?: boolean }): Promise<RequirementWithOverdue[]> }`
  - 需求状态宽松(spec D5 精神):任意状态可切,不做状态机校验;进入 `done` 写 `completedAt`,离开 `done` 清空之。
  - 变更记录:status 变化 `status_change`;title/summary/priority/计划时间实质变化 `update`。
  - 错误:项目不存在 `NOT_FOUND`;需求不存在 `NOT_FOUND`。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/requirement.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, projects, type RequirementRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import {
  computeOverdue,
  RequirementService,
  type RequirementWithOverdue,
} from './requirement.service.js';

const DAY = 86_400_000;

function baseReq(): RequirementRow {
  return {
    id: 'r',
    projectId: 'p',
    title: 'R',
    summary: null,
    priority: 'P2',
    planStartAt: null,
    planDueAt: null,
    completedAt: null,
    status: 'confirmed',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('computeOverdue', () => {
  it('超期:draft/confirmed 且 planDueAt 已过 → overdue + 天数', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now - 3.5 * DAY }, now),
    ).toEqual({ overdue: true, overdueDays: 3, dueSoon: false });
    expect(
      computeOverdue({ ...baseReq(), status: 'draft', planDueAt: now - 1 * DAY }, now),
    ).toEqual({ overdue: true, overdueDays: 1, dueSoon: false });
  });

  it('未超期但 ≤3 天 → dueSoon', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now + 2 * DAY }, now),
    ).toEqual({ overdue: false, overdueDays: 0, dueSoon: true });
    expect(
      computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: now + 4 * DAY }, now),
    ).toEqual({ overdue: false, overdueDays: 0, dueSoon: false });
  });

  it('done/archived 不参与;未设 planDueAt 不参与', () => {
    const now = Date.now();
    expect(
      computeOverdue({ ...baseReq(), status: 'done', planDueAt: now - 10 * DAY }, now).overdue,
    ).toBe(false);
    expect(computeOverdue({ ...baseReq(), status: 'confirmed', planDueAt: null }, now)).toEqual({
      overdue: false,
      overdueDays: 0,
      dueSoon: false,
    });
  });
});

describe('RequirementService', () => {
  it('createRequirement:默认 P2/draft;projectId 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement(
        { projectId: p.id, title: '导出功能', priority: 'P0', planDueAt: Date.now() + 1000 },
        'human',
      );
      expect(r).toMatchObject({ status: 'draft', priority: 'P0', completedAt: null });
      try {
        await svc.createRequirement({ projectId: 'missing', title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('updateRequirement:进 done 写 completedAt 并记 status_change;离开 done 清空', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement({ projectId: p.id, title: 'A' }, 'human');
      const done = await svc.updateRequirement(r.id, { status: 'done' }, 'human');
      expect(done.completedAt).not.toBeNull();
      expect(
        await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'status_change')),
      ).toHaveLength(1);

      const reopened = await svc.updateRequirement(r.id, { status: 'confirmed' }, 'human');
      expect(reopened.completedAt).toBeNull();
    });
  });

  it('updateRequirement:title 变更记 update,不动 completedAt', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r = await svc.createRequirement({ projectId: p.id, title: '旧' }, 'human');
      await svc.updateRequirement(r.id, { title: '新' }, 'human');
      const logs = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'update'));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.beforeSnapshot).toMatchObject({ title: '旧' });
    });
  });

  it('listRequirements:overdue=true 过滤只留超期项,并带计算字段', async () => {
    await withDb(async (db) => {
      const svc = new RequirementService(db);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      await svc.createRequirement(
        { projectId: p.id, title: '已超期', planDueAt: now - 5 * DAY },
        'human',
      );
      await svc.createRequirement(
        { projectId: p.id, title: '临期', planDueAt: now + 2 * DAY },
        'human',
      );
      await svc.createRequirement(
        { projectId: p.id, title: '远期', planDueAt: now + 30 * DAY },
        'human',
      );
      await svc.createRequirement({ projectId: p.id, title: '无期限' }, 'human');

      const all = await svc.listRequirements(p.id);
      expect(all).toHaveLength(4);
      expect(all.every((r: RequirementWithOverdue) => typeof r.overdue === 'boolean')).toBe(true);

      const overdue = await svc.listRequirements(p.id, { overdue: true });
      expect(overdue.map((r) => r.title)).toEqual(['已超期']);
      expect(overdue[0]?.overdueDays).toBe(5);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/requirement.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/requirement.service.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { projects, requirements, type RequirementRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

const DAY_MS = 86_400_000;

/** spec §4.3 超期判定:计算态,不落库 */
export function computeOverdue(
  req: RequirementRow,
  now = Date.now(),
): { overdue: boolean; overdueDays: number; dueSoon: boolean } {
  if (!req.planDueAt || (req.status !== 'draft' && req.status !== 'confirmed')) {
    return { overdue: false, overdueDays: 0, dueSoon: false };
  }
  const diffDays = Math.floor((req.planDueAt - now) / DAY_MS);
  if (diffDays < 0) return { overdue: true, overdueDays: -diffDays, dueSoon: false };
  return { overdue: false, overdueDays: 0, dueSoon: diffDays <= 3 };
}

export interface CreateRequirementInput {
  projectId: string;
  title: string;
  summary?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  planStartAt?: number;
  planDueAt?: number;
}

export interface UpdateRequirementInput {
  title?: string;
  summary?: string;
  status?: 'draft' | 'confirmed' | 'done' | 'archived';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  planStartAt?: number | null;
  planDueAt?: number | null;
}

export type RequirementWithOverdue = RequirementRow & {
  overdue: boolean;
  overdueDays: number;
  dueSoon: boolean;
};

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

export class RequirementService {
  constructor(private db: ShipmateDb) {}

  async createRequirement(input: CreateRequirementInput, actor: Actor): Promise<RequirementRow> {
    const title = input.title?.trim();
    if (!title) throw new DomainError('VALIDATION_ERROR', '需求标题不能为空');
    if (input.priority && !PRIORITIES.includes(input.priority)) {
      throw new DomainError('VALIDATION_ERROR', `非法优先级 ${input.priority}`);
    }
    return this.db.transaction(async (tx) => {
      if (!(await tx.select().from(projects).where(eq(projects.id, input.projectId)))) {
        throw new DomainError('NOT_FOUND', `项目 ${input.projectId} 不存在`);
      }
      const now = Date.now();
      const rows = await tx
        .insert(requirements)
        .values({
          id: newId(),
          projectId: input.projectId,
          title,
          summary: input.summary ?? null,
          status: 'draft',
          priority: input.priority ?? 'P2',
          planStartAt: input.planStartAt ?? null,
          planDueAt: input.planDueAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'requirement',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateRequirement(
    id: string,
    input: UpdateRequirementInput,
    actor: Actor,
  ): Promise<RequirementRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(requirements).where(eq(requirements.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求 ${id} 不存在`);

      const patch: Partial<typeof requirements.$inferInsert> = { updatedAt: Date.now() };
      let contentChanged = false;
      let statusChanged = false;

      if (input.title !== undefined && input.title.trim() !== before.title) {
        if (!input.title.trim()) throw new DomainError('VALIDATION_ERROR', '需求标题不能为空');
        patch.title = input.title.trim();
        contentChanged = true;
      }
      if (input.summary !== undefined && input.summary !== before.summary) {
        patch.summary = input.summary;
        contentChanged = true;
      }
      if (input.priority !== undefined && input.priority !== before.priority) {
        if (!PRIORITIES.includes(input.priority))
          throw new DomainError('VALIDATION_ERROR', `非法优先级 ${input.priority}`);
        patch.priority = input.priority;
        contentChanged = true;
      }
      if (input.planStartAt !== undefined && input.planStartAt !== before.planStartAt) {
        patch.planStartAt = input.planStartAt;
        contentChanged = true;
      }
      if (input.planDueAt !== undefined && input.planDueAt !== before.planDueAt) {
        patch.planDueAt = input.planDueAt;
        contentChanged = true;
      }
      if (input.status !== undefined && input.status !== before.status) {
        patch.status = input.status;
        statusChanged = true;
        if (input.status === 'done') patch.completedAt = Date.now();
        if (before.status === 'done' && input.status !== 'done') patch.completedAt = null;
      }

      if (!contentChanged && !statusChanged) return before;

      const after = (
        await tx.update(requirements).set(patch).where(eq(requirements.id, id)).returning()
      )[0]!;
      if (contentChanged) {
        await writeChangeLog(tx, {
          entityType: 'requirement',
          entityId: id,
          changeType: 'update',
          before,
          after,
          actor,
        });
      }
      if (statusChanged) {
        await writeChangeLog(tx, {
          entityType: 'requirement',
          entityId: id,
          changeType: 'status_change',
          before,
          after,
          actor,
        });
      }
      return after;
    });
  }

  async listRequirements(
    projectId: string,
    filter?: { status?: string; priority?: string; overdue?: boolean },
  ): Promise<RequirementWithOverdue[]> {
    const conds = [eq(requirements.projectId, projectId)];
    if (filter?.status)
      conds.push(eq(requirements.status, filter.status as RequirementRow['status']));
    if (filter?.priority)
      conds.push(eq(requirements.priority, filter.priority as RequirementRow['priority']));
    const rows = await this.db
      .select()
      .from(requirements)
      .where(and(...conds));
    const decorated = rows.map((r) => ({ ...r, ...computeOverdue(r) }));
    if (filter?.overdue === true) return decorated.filter((r) => r.overdue);
    return decorated;
  }
}
```

同步修改 `packages/core/src/services/project.service.ts`:删除底部过渡函数 `isOverdue`,顶部改 `import { computeOverdue } from './requirement.service.js';`,`getProject` 内 `isOverdue(r)` 改为 `computeOverdue(r).overdue`。

- [ ] **Step 4: 跑测试确认通过(含 ProjectService 回归)**

Run: `pnpm -C packages/core test src/services/requirement.service.test.ts src/services/project.service.test.ts && pnpm -C packages/core typecheck`
Expected: 全部 PASS。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export {
  RequirementService,
  computeOverdue,
  type CreateRequirementInput,
  type RequirementWithOverdue,
} from './services/requirement.service.js';
```

```bash
git add packages/core/src/services/requirement.service.ts packages/core/src/services/requirement.service.test.ts packages/core/src/services/project.service.ts packages/core/src/index.ts
git commit -m "feat(core): RequirementService 与超期/临期计算态"
```

---

### Task 8: TaskService(状态机 + 重估确认)

**Files:**

- Create: `packages/core/src/services/task.service.ts`
- Test: `packages/core/src/services/task.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `writeChangeLog`、`DomainError`、`withDb`、`tasks/requirementPoints/requirements` 表、`newId`。
- Produces:
  - `type TaskAction = 'start' | 'complete'`
  - `class TaskService { constructor(db: ShipmateDb); async createTask(input: { requirementPointId: string; title: string; description?: string; sortOrder?: number }, actor: Actor): Promise<TaskRow>; async updateTask(id: string, input: { title?: string; description?: string; sortOrder?: number }, actor: Actor): Promise<TaskRow>; async setTaskStatus(id: string, action: TaskAction, actor: Actor): Promise<TaskRow>; async listTasks(filter: { requirementPointId?: string; projectId?: string; status?: 'pending'|'in_progress'|'done'|'needs_reassessment' }): Promise<TaskRow[]>; async confirmTaskReassessment(id: string, actor: Actor): Promise<TaskRow> }`
  - 状态机(spec §4.2):`pending --start--> in_progress --complete--> done`;`needs_reassessment --confirm_reassessment--> pending`;其余流转抛 `INVALID_STATUS_TRANSITION`(含 done→start、pending→complete 等)。
  - `updateTask` 的 title/description 变化记 `update` ChangeLog(任务自身无 version 字段,不触发联动——联动仅由需求点实质修改发起,见 Task 9)。
  - `setTaskStatus` 记 `status_change`;`confirmTaskReassessment` 亦记 `status_change`(reason 固定说明重估确认)。
  - 错误:任务/需求点不存在 `NOT_FOUND`。
  - `listTasks({ projectId })` 通过 requirementPoints→requirements 联表过滤;过滤条件可组合。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/task.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  projects,
  requirementPoints,
  requirements,
  tasks,
  type TaskRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { TaskService } from './task.service.js';

/** 测试辅助:绕过状态机直接置状态(模拟联动结果) */
async function forceTaskStatus(db: ShipmateDb, taskId: string, status: TaskRow['status']) {
  await db.execute(sql`UPDATE tasks SET status = ${status} WHERE id = ${taskId}`);
}

/** 测试辅助:建一条需求点链(project → requirement → point),返回 pointId */
async function seedPoint(db: ShipmateDb): Promise<string> {
  const now = Date.now();
  const p = (
    await db
      .insert(projects)
      .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
      .returning()
  )[0]!;
  const r = (
    await db
      .insert(requirements)
      .values({
        id: newId(),
        projectId: p.id,
        title: 'R',
        status: 'draft',
        priority: 'P2',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  const pt = (
    await db
      .insert(requirementPoints)
      .values({
        id: newId(),
        requirementId: r.id,
        title: 'PT',
        status: 'draft',
        version: 1,
        sourceMaterialIds: [],
        evidences: [],
        origin: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  return pt.id;
}

describe('TaskService', () => {
  it('createTask:默认 pending/sortOrder 0;需求点不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: '写迁移脚本' }, 'human');
      expect(t).toMatchObject({ status: 'pending', sortOrder: 0, commitRefs: [] });
      try {
        await svc.createTask({ requirementPointId: 'missing', title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('状态机:pending→in_progress→done 合法;跳跃与回退非法', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: 'T' }, 'human');
      expect((await svc.setTaskStatus(t.id, 'start', 'human')).status).toBe('in_progress');
      expect((await svc.setTaskStatus(t.id, 'complete', 'human')).status).toBe('done');
      for (const action of ['complete', 'start'] as const) {
        try {
          await svc.setTaskStatus(t.id, action, 'human');
          expect.unreachable(`应当抛错:${action}`);
        } catch (e) {
          expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
        }
      }
    });
  });

  it('confirmTaskReassessment:needs_reassessment 回 pending;其他状态抛错', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: 'T' }, 'human');
      await forceTaskStatus(db, t.id, 'needs_reassessment');
      const ok = await svc.confirmTaskReassessment(t.id, 'mcp:claude-code');
      expect(ok.status).toBe('pending');
      try {
        await svc.confirmTaskReassessment(t.id, 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  it('updateTask:title 变化记 update log', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      const t = await svc.createTask({ requirementPointId: pointId, title: '旧' }, 'human');
      await svc.updateTask(t.id, { title: '新', sortOrder: 3 }, 'human');
      const log = await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'update'));
      expect(log).toHaveLength(1);
    });
  });

  it('listTasks:按需求点/状态过滤;按项目过滤走联表', async () => {
    await withDb(async (db) => {
      const svc = new TaskService(db);
      const pointId = await seedPoint(db);
      await svc.createTask({ requirementPointId: pointId, title: 'T1' }, 'human');
      await svc.createTask({ requirementPointId: pointId, title: 'T2', sortOrder: 1 }, 'human');
      const t3 = await svc.createTask(
        { requirementPointId: pointId, title: 'T3', sortOrder: 2 },
        'human',
      );
      await svc.setTaskStatus(t3.id, 'start', 'human');

      expect(await svc.listTasks({ requirementPointId: pointId })).toHaveLength(3);
      expect(
        (await svc.listTasks({ requirementPointId: pointId, status: 'in_progress' })).map(
          (t) => t.title,
        ),
      ).toEqual(['T3']);
      const point = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.id, pointId))
      )[0]!;
      const req = (
        await db.select().from(requirements).where(eq(requirements.id, point.requirementId))
      )[0]!;
      expect(await svc.listTasks({ projectId: req.projectId })).toHaveLength(3);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/task.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/task.service.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { requirementPoints, requirements, tasks, type TaskRow } from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export type TaskAction = 'start' | 'complete';

/** spec §4.2:合法流转表;needs_reassessment 仅由联动写入与 confirmTaskReassessment 移出 */
const TASK_TRANSITIONS: Partial<
  Record<TaskRow['status'], Partial<Record<TaskAction, TaskRow['status']>>>
> = {
  pending: { start: 'in_progress' },
  in_progress: { complete: 'done' },
};

export interface CreateTaskInput {
  requirementPointId: string;
  title: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  sortOrder?: number;
}

export interface ListTaskFilter {
  requirementPointId?: string;
  projectId?: string;
  status?: TaskRow['status'];
}

export class TaskService {
  constructor(private db: ShipmateDb) {}

  async createTask(input: CreateTaskInput, actor: Actor): Promise<TaskRow> {
    const title = input.title?.trim();
    if (!title) throw new DomainError('VALIDATION_ERROR', '任务标题不能为空');
    return this.db.transaction(async (tx) => {
      if (
        !(await tx
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.id, input.requirementPointId)))
      ) {
        throw new DomainError('NOT_FOUND', `需求点 ${input.requirementPointId} 不存在`);
      }
      const now = Date.now();
      const rows = await tx
        .insert(tasks)
        .values({
          id: newId(),
          requirementPointId: input.requirementPointId,
          title,
          description: input.description ?? null,
          status: 'pending',
          sortOrder: input.sortOrder ?? 0,
          commitRefs: [],
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  async updateTask(id: string, input: UpdateTaskInput, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: Date.now() };
      let changed = false;
      if (input.title !== undefined && input.title.trim() !== before.title) {
        if (!input.title.trim()) throw new DomainError('VALIDATION_ERROR', '任务标题不能为空');
        patch.title = input.title.trim();
        changed = true;
      }
      if (input.description !== undefined && input.description !== before.description) {
        patch.description = input.description;
        changed = true;
      }
      if (input.sortOrder !== undefined && input.sortOrder !== before.sortOrder) {
        patch.sortOrder = input.sortOrder;
        changed = true;
      }
      if (!changed) return before;
      const after = (await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning())[0]!;
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: id,
        changeType: 'update',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async setTaskStatus(id: string, action: TaskAction, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      const next = TASK_TRANSITIONS[before.status]?.[action];
      if (!next) {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `任务不允许从 ${before.status} 经 ${action} 流转`,
        );
      }
      const after = (
        await tx
          .update(tasks)
          .set({ status: next, updatedAt: Date.now() })
          .where(eq(tasks.id, id))
          .returning()
      )[0]!;
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: id,
        changeType: 'status_change',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async listTasks(filter: ListTaskFilter): Promise<TaskRow[]> {
    if (filter.projectId !== undefined) {
      const pointIds = (
        await this.db
          .select({ id: requirementPoints.id })
          .from(requirementPoints)
          .innerJoin(requirements, eq(requirementPoints.requirementId, requirements.id))
          .where(eq(requirements.projectId, filter.projectId))
      ).map((r) => r.id);
      if (pointIds.length === 0) return [];
      const conds = [inArray(tasks.requirementPointId, pointIds)];
      if (filter.status) conds.push(eq(tasks.status, filter.status));
      if (filter.requirementPointId)
        conds.push(eq(tasks.requirementPointId, filter.requirementPointId));
      return this.db
        .select()
        .from(tasks)
        .where(and(...conds));
    }
    const conds = [];
    if (filter.requirementPointId)
      conds.push(eq(tasks.requirementPointId, filter.requirementPointId));
    if (filter.status) conds.push(eq(tasks.status, filter.status));
    return conds.length
      ? this.db
          .select()
          .from(tasks)
          .where(and(...conds))
      : this.db.select().from(tasks);
  }

  async confirmTaskReassessment(id: string, actor: Actor): Promise<TaskRow> {
    return this.db.transaction(async (tx) => {
      const before = (await tx.select().from(tasks).where(eq(tasks.id, id)))[0];
      if (!before) throw new DomainError('NOT_FOUND', `任务 ${id} 不存在`);
      if (before.status !== 'needs_reassessment') {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `任务当前状态 ${before.status},仅 needs_reassessment 可确认重估`,
        );
      }
      const after = (
        await tx
          .update(tasks)
          .set({ status: 'pending', updatedAt: Date.now() })
          .where(eq(tasks.id, id))
          .returning()
      )[0]!;
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: id,
        changeType: 'status_change',
        before,
        after,
        reason: '重估确认:任务回到待办,重新走开发流程',
        actor,
      });
      return after;
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/task.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,5 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export { TaskService, type TaskAction, type CreateTaskInput } from './services/task.service.js';
```

```bash
git add packages/core/src/services/task.service.ts packages/core/src/services/task.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): TaskService 任务状态机与重估确认"
```

---

### Task 9: RequirementPointService(实质修改联动事务,心脏)

**Files:**

- Create: `packages/core/src/services/requirement-point.service.ts`
- Test: `packages/core/src/services/requirement-point.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `writeChangeLog`、`DomainError`、`withDb`、`requirementPoints/tasks/requirements` 表、`newId`。
- Produces:
  - `type PointAction = 'confirm' | 'start' | 'complete'`
  - `type UpdatePointResult = { point: RequirementPointRow; affectedTaskCount: number }`
  - `type RequirementPointDetail = { point: RequirementPointRow; tasks: TaskRow[]; changeLogs: ChangeLogRow[] }`(changeLogs 按 createdAt 倒序)
  - `class RequirementPointService { constructor(db: ShipmateDb); async listRequirementPoints(filter: { requirementId?: string; projectId?: string; status?: 'draft'|'confirmed'|'developing'|'done' }): Promise<RequirementPointRow[]>; async getRequirementPoint(id: string): Promise<RequirementPointDetail>; async updateRequirementPoint(id: string, input: { title?: string; description?: string; reason?: string }, actor: Actor): Promise<UpdatePointResult>; async setRequirementPointStatus(id: string, action: PointAction, actor: Actor): Promise<RequirementPointRow>; async confirmRequirementPoint(id: string, actor: Actor): Promise<RequirementPointRow> }`
  - 状态机(spec §4.1):`draft --confirm--> confirmed --start--> developing --complete--> done`;其余 action 组合抛 `INVALID_STATUS_TRANSITION`。
  - **实质修改联动(spec §5.3,单事务四件事)**:title/description 内容变化时 ① version+1 且 developing/done 回退 confirmed(draft 保持 draft);② 写该点 `update` ChangeLog;③ 其下所有非 needs_reassessment 任务置 needs_reassessment,各写一条 `status_change` ChangeLog;④ 写一条 `linkage_impact` ChangeLog(reason 含受影响任务数)。返回 `affectedTaskCount`。无内容变化时不做任何事,返回原行与 0。
  - `setRequirementPointStatus` 记 `status_change`。
  - 错误:点不存在 `NOT_FOUND`。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/requirement-point.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, projects, requirementPoints, requirements } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { TaskService } from './task.service.js';
import { RequirementPointService } from './requirement-point.service.js';

/** 测试辅助:建 project → requirement 链,返回 requirementId */
async function seedRequirement(db: ShipmateDb): Promise<string> {
  const now = Date.now();
  const p = (
    await db
      .insert(projects)
      .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
      .returning()
  )[0]!;
  const r = (
    await db
      .insert(requirements)
      .values({
        id: newId(),
        projectId: p.id,
        title: 'R',
        status: 'draft',
        priority: 'P2',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  return r.id;
}

async function seedPoint(
  db: ShipmateDb,
  reqId: string,
  status: 'draft' | 'confirmed' | 'developing' | 'done',
  version = 1,
): Promise<string> {
  const now = Date.now();
  const rows = await db
    .insert(requirementPoints)
    .values({
      id: newId(),
      requirementId: reqId,
      title: '点',
      description: '描述',
      status,
      version,
      sourceMaterialIds: [],
      evidences: [],
      origin: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0]!.id;
}

describe('RequirementPointService 状态机', () => {
  it('draft→confirm→start→complete 全链合法并记 status_change', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      expect((await svc.setRequirementPointStatus(id, 'confirm', 'human')).status).toBe(
        'confirmed',
      );
      expect((await svc.setRequirementPointStatus(id, 'start', 'human')).status).toBe('developing');
      expect((await svc.setRequirementPointStatus(id, 'complete', 'human')).status).toBe('done');
      const logs = await db
        .select()
        .from(changeLogs)
        .where(eq(changeLogs.changeType, 'status_change'));
      expect(logs).toHaveLength(3);
    });
  });

  it('非法流转抛 INVALID_STATUS_TRANSITION', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      try {
        await svc.setRequirementPointStatus(id, 'start', 'human');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  it('confirmRequirementPoint 是 confirm 别名', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      expect((await svc.confirmRequirementPoint(id, 'mcp:claude-code')).status).toBe('confirmed');
    });
  });
});

describe('实质修改联动(spec §5.3)', () => {
  it('developing 点改标题:回 confirmed、version+1、任务打标、linkage_impact', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'developing', 3);
      await taskSvc.createTask({ requirementPointId: id, title: 'T1' }, 'human');
      const t2 = await taskSvc.createTask({ requirementPointId: id, title: 'T2' }, 'human');
      await taskSvc.setTaskStatus(t2.id, 'start', 'human');

      const result = await svc.updateRequirementPoint(
        id,
        { title: '改后的点', reason: '口径变化' },
        'human',
      );
      expect(result.affectedTaskCount).toBe(2);
      expect(result.point).toMatchObject({ status: 'confirmed', version: 4, title: '改后的点' });

      const allTasks = await taskSvc.listTasks({ requirementPointId: id });
      expect(allTasks.every((t) => t.status === 'needs_reassessment')).toBe(true);

      const kinds = (await db.select().from(changeLogs).where(eq(changeLogs.entityId, id))).map(
        (l) => l.changeType,
      );
      expect(kinds).toContain('update');
      expect(kinds).toContain('linkage_impact');
      const taskLogs = await db.select().from(changeLogs).where(eq(changeLogs.entityType, 'task'));
      expect(taskLogs.filter((l) => l.changeType === 'status_change')).toHaveLength(2);
    });
  });

  it('done 点改描述:同样回退 confirmed', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'done', 2);
      const result = await svc.updateRequirementPoint(id, { description: '新描述' }, 'human');
      expect(result.point).toMatchObject({ status: 'confirmed', version: 3 });
    });
  });

  it('draft 点实质修改:状态保持 draft,version+1,仍联动任务', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      await taskSvc.createTask({ requirementPointId: id, title: 'T1' }, 'human');
      const result = await svc.updateRequirementPoint(id, { title: 'draft 期修改' }, 'human');
      expect(result.point).toMatchObject({ status: 'draft', version: 2 });
      expect(result.affectedTaskCount).toBe(1);
    });
  });

  it('无实质变化时不写任何 log、不动 version', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'confirmed', 7);
      const beforeLogs = (await db.select().from(changeLogs)).length;
      const result = await svc.updateRequirementPoint(id, { title: '点' }, 'human');
      expect(result).toEqual({
        point: expect.objectContaining({ version: 7 }),
        affectedTaskCount: 0,
      });
      expect(await db.select().from(changeLogs)).toHaveLength(beforeLogs);
    });
  });

  it('已是 needs_reassessment 的任务不重复打标', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'developing');
      const t = await taskSvc.createTask({ requirementPointId: id, title: 'T' }, 'human');
      await svc.updateRequirementPoint(id, { title: '改一' }, 'human');
      await svc.updateRequirementPoint(id, { title: '改二' }, 'human');
      const taskStatusLogs = (
        await db.select().from(changeLogs).where(eq(changeLogs.entityId, t.id))
      ).filter((l) => l.changeType === 'status_change');
      expect(taskStatusLogs).toHaveLength(1); // 第二轮因已是 needs_reassessment 被跳过
    });
  });

  it('点不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      try {
        await svc.updateRequirementPoint('missing', { title: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });
});

describe('查询', () => {
  it('getRequirementPoint 返回点 + 任务 + 变更历史', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const taskSvc = new TaskService(db);
      const reqId = await seedRequirement(db);
      const id = await seedPoint(db, reqId, 'draft');
      await taskSvc.createTask({ requirementPointId: id, title: 'T' }, 'human');
      const detail = await svc.getRequirementPoint(id);
      expect(detail.point.id).toBe(id);
      expect(detail.tasks).toHaveLength(1);
      expect(detail.changeLogs.length).toBeGreaterThan(0);
      try {
        await svc.getRequirementPoint('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listRequirementPoints 按状态过滤,projectId 走联表', async () => {
    await withDb(async (db) => {
      const svc = new RequirementPointService(db);
      const reqId = await seedRequirement(db);
      await seedPoint(db, reqId, 'draft');
      await seedPoint(db, reqId, 'done');
      expect(await svc.listRequirementPoints({ requirementId: reqId })).toHaveLength(2);
      expect(
        await svc.listRequirementPoints({ requirementId: reqId, status: 'done' }),
      ).toHaveLength(1);
      const req = (await db.select().from(requirements).where(eq(requirements.id, reqId)))[0]!;
      expect(await svc.listRequirementPoints({ projectId: req.projectId })).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/requirement-point.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/requirement-point.service.ts`:

```ts
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  changeLogs,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
  type RequirementPointRow,
  type TaskRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';

export type PointAction = 'confirm' | 'start' | 'complete';

/** spec §4.1 显式流转表(实质修改的回退不在表内,由 updateRequirementPoint 单独处理) */
const POINT_TRANSITIONS: Partial<
  Record<RequirementPointRow['status'], Partial<Record<PointAction, RequirementPointRow['status']>>>
> = {
  draft: { confirm: 'confirmed' },
  confirmed: { start: 'developing' },
  developing: { complete: 'done' },
};

export interface UpdatePointInput {
  title?: string;
  description?: string;
  reason?: string;
}

export interface UpdatePointResult {
  point: RequirementPointRow;
  affectedTaskCount: number;
}

export interface RequirementPointDetail {
  point: RequirementPointRow;
  tasks: TaskRow[];
  changeLogs: ChangeLogRow[];
}

export class RequirementPointService {
  constructor(private db: ShipmateDb) {}

  /** spec §5.3:实质修改单事务四件事,要么全成要么全不动 */
  async updateRequirementPoint(
    id: string,
    input: UpdatePointInput,
    actor: Actor,
  ): Promise<UpdatePointResult> {
    return this.db.transaction(async (tx): Promise<UpdatePointResult> => {
      const before = (
        await tx.select().from(requirementPoints).where(eq(requirementPoints.id, id))
      )[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);

      const nextTitle = input.title !== undefined ? input.title.trim() : before.title;
      const nextDesc = input.description !== undefined ? input.description : before.description;
      if (input.title !== undefined && !nextTitle)
        throw new DomainError('VALIDATION_ERROR', '需求点标题不能为空');

      const substantive = nextTitle !== before.title || nextDesc !== before.description;
      if (!substantive) return { point: before, affectedTaskCount: 0 };

      // spec §4.1:developing/done 实质修改回退 confirmed;draft 保持 draft
      const nextStatus: RequirementPointRow['status'] =
        before.status === 'developing' || before.status === 'done' ? 'confirmed' : before.status;

      const after = (
        await tx
          .update(requirementPoints)
          .set({
            title: nextTitle,
            description: nextDesc,
            status: nextStatus,
            version: before.version + 1,
            updatedAt: Date.now(),
          })
          .where(eq(requirementPoints.id, id))
          .returning()
      )[0]!;

      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'update',
        before,
        after,
        reason: input.reason,
        actor,
      });

      // 联动:其下所有非 needs_reassessment 任务
      const affected = await tx
        .update(tasks)
        .set({ status: 'needs_reassessment', updatedAt: Date.now() })
        .where(and(eq(tasks.requirementPointId, id), ne(tasks.status, 'needs_reassessment')))
        .returning();
      for (const t of affected) {
        await writeChangeLog(tx, {
          entityType: 'task',
          entityId: t.id,
          changeType: 'status_change',
          after: t,
          reason: `需求点「${after.title}」实质修改,联动待重估`,
          actor,
        });
      }

      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'linkage_impact',
        after,
        reason: `联动影响 ${affected.length} 个任务`,
        actor,
      });

      return { point: after, affectedTaskCount: affected.length };
    });
  }

  async setRequirementPointStatus(
    id: string,
    action: PointAction,
    actor: Actor,
  ): Promise<RequirementPointRow> {
    return this.db.transaction(async (tx) => {
      const before = (
        await tx.select().from(requirementPoints).where(eq(requirementPoints.id, id))
      )[0];
      if (!before) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);
      const next = POINT_TRANSITIONS[before.status]?.[action];
      if (!next) {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `需求点不允许从 ${before.status} 经 ${action} 流转`,
        );
      }
      const after = (
        await tx
          .update(requirementPoints)
          .set({ status: next, updatedAt: Date.now() })
          .where(eq(requirementPoints.id, id))
          .returning()
      )[0]!;
      await writeChangeLog(tx, {
        entityType: 'requirement_point',
        entityId: id,
        changeType: 'status_change',
        before,
        after,
        actor,
      });
      return after;
    });
  }

  async confirmRequirementPoint(id: string, actor: Actor): Promise<RequirementPointRow> {
    return this.setRequirementPointStatus(id, 'confirm', actor);
  }

  async getRequirementPoint(id: string): Promise<RequirementPointDetail> {
    const point = (
      await this.db.select().from(requirementPoints).where(eq(requirementPoints.id, id))
    )[0];
    if (!point) throw new DomainError('NOT_FOUND', `需求点 ${id} 不存在`);
    const pointTasks = await this.db.select().from(tasks).where(eq(tasks.requirementPointId, id));
    const pointLogs = await this.db
      .select()
      .from(changeLogs)
      .where(eq(changeLogs.entityId, id))
      .orderBy(desc(changeLogs.createdAt));
    return { point, tasks: pointTasks, changeLogs: pointLogs };
  }

  async listRequirementPoints(filter: {
    requirementId?: string;
    projectId?: string;
    status?: RequirementPointRow['status'];
  }): Promise<RequirementPointRow[]> {
    if (filter.projectId !== undefined) {
      const reqIds = (
        await this.db
          .select({ id: requirements.id })
          .from(requirements)
          .where(eq(requirements.projectId, filter.projectId))
      ).map((r) => r.id);
      if (reqIds.length === 0) return [];
      const conds = [inArray(requirementPoints.requirementId, reqIds)];
      if (filter.status) conds.push(eq(requirementPoints.status, filter.status));
      if (filter.requirementId)
        conds.push(eq(requirementPoints.requirementId, filter.requirementId));
      return this.db
        .select()
        .from(requirementPoints)
        .where(and(...conds));
    }
    const conds = [];
    if (filter.requirementId) conds.push(eq(requirementPoints.requirementId, filter.requirementId));
    if (filter.status) conds.push(eq(requirementPoints.status, filter.status));
    return conds.length
      ? this.db
          .select()
          .from(requirementPoints)
          .where(and(...conds))
      : this.db.select().from(requirementPoints);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/requirement-point.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,11 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export {
  RequirementPointService,
  type PointAction,
  type UpdatePointResult,
  type RequirementPointDetail,
} from './services/requirement-point.service.js';
```

```bash
git add packages/core/src/services/requirement-point.service.ts packages/core/src/services/requirement-point.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): 需求点服务——实质修改联动事务(状态回退/任务打标/linkage_impact)"
```

---

### Task 10: AuditService

**Files:**

- Create: `packages/core/src/services/audit.service.ts`
- Test: `packages/core/src/services/audit.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `changeLogs/projects/requirements/requirementPoints/analysisRuns/materials` 表、`DomainError`、`withDb`。
- Produces:
  - `type ActorKind = 'human' | 'ai' | 'mcp'`
  - `type AuditReport = { timeline: ChangeLogRow[]; actorDistribution: Record<ActorKind, number>; entityTypeDistribution: Record<string, number>; dailyCounts: { date: string; count: number }[] }`
  - `class AuditService { constructor(db: ShipmateDb); async getChangeLog(filter: { entityType: ChangeLogRow['entityType']; entityId: string; limit?: number }): Promise<ChangeLogRow[]>; async getProjectAuditReport(projectId: string): Promise<AuditReport> }`
  - `getChangeLog` 按 createdAt 倒序,limit 默认 100。
  - `getProjectAuditReport`:收集项目内全部实体 id(project 自身 + requirements + points + tasks + analysis_runs + materials),查这些 id 的全部变更;timeline 限 500 条倒序;actor 分布按 `human` / `mcp:` 前缀 / `ai:analysis` 三类;dailyCounts 按本地日期 `YYYY-MM-DD` 聚合升序。项目不存在抛 `NOT_FOUND`。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/audit.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withDb } from '../db/database.js';
import { projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { GroupService } from './group.service.js';
import { ProjectService } from './project.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('getProjectAuditReport:时间线 + actor 分布 + 类型分布 + 日计数', async () => {
    await withDb(async (db) => {
      const groups = new GroupService(db);
      const projectsSvc = new ProjectService(db);
      const audit = new AuditService(db);
      const g = await groups.createGroup({ name: 'G' }, 'human');
      const p = await projectsSvc.createProject({ groupId: g.id, name: '项目' }, 'human');
      await projectsSvc.updateProject(p.id, { name: '项目改名' }, 'mcp:claude-code');
      await projectsSvc.updateProject(p.id, { status: 'archived' }, 'human');

      const report = await audit.getProjectAuditReport(p.id);
      expect(report.timeline.length).toBeGreaterThanOrEqual(3); // create + update + status_change
      expect(report.actorDistribution).toMatchObject({ human: 2, mcp: 1 });
      expect(report.entityTypeDistribution['project']).toBeGreaterThanOrEqual(3);
      expect(report.dailyCounts.length).toBeGreaterThanOrEqual(1);
      expect(report.dailyCounts[0]).toMatchObject({ count: report.timeline.length });
    });
  });

  it('getProjectAuditReport:项目不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const audit = new AuditService(db);
      try {
        await audit.getProjectAuditReport('missing');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('getChangeLog:limit 与倒序', async () => {
    await withDb(async (db) => {
      const audit = new AuditService(db);
      const projectsSvc = new ProjectService(db);
      const p = await projectsSvc.createProject({ name: 'P' }, 'human');
      for (let i = 0; i < 5; i++)
        await projectsSvc.updateProject(p.id, { name: `名字${i}` }, 'human');

      const rows = await audit.getChangeLog({ entityType: 'project', entityId: p.id, limit: 3 });
      expect(rows).toHaveLength(3);
      expect(rows[0]!.createdAt).toBeGreaterThanOrEqual(rows[2]!.createdAt);
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/audit.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/audit.service.ts`:

```ts
import { desc, eq, inArray } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  changeLogs,
  materials,
  projects,
  requirementPoints,
  requirements,
  tasks,
  type ChangeLogRow,
} from '../db/schema.js';
import { DomainError } from '../errors.js';

export type ActorKind = 'human' | 'ai' | 'mcp';

export interface AuditReport {
  timeline: ChangeLogRow[];
  actorDistribution: Record<ActorKind, number>;
  entityTypeDistribution: Record<string, number>;
  dailyCounts: { date: string; count: number }[];
}

function actorKind(actor: string): ActorKind {
  if (actor === 'human') return 'human';
  if (actor.startsWith('mcp:')) return 'mcp';
  return 'ai';
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export class AuditService {
  constructor(private db: ShipmateDb) {}

  async getChangeLog(filter: {
    entityType: ChangeLogRow['entityType'];
    entityId: string;
    limit?: number;
  }): Promise<ChangeLogRow[]> {
    const rows = await this.db
      .select()
      .from(changeLogs)
      .where(eq(changeLogs.entityId, filter.entityId))
      .orderBy(desc(changeLogs.createdAt))
      .limit(filter.limit ?? 100);
    return rows.filter((r) => r.entityType === filter.entityType);
  }

  async getProjectAuditReport(projectId: string): Promise<AuditReport> {
    const project = (await this.db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project) throw new DomainError('NOT_FOUND', `项目 ${projectId} 不存在`);

    const reqs = await this.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    const reqIds = reqs.map((r) => r.id);
    const points = reqIds.length
      ? await this.db
          .select()
          .from(requirementPoints)
          .where(inArray(requirementPoints.requirementId, reqIds))
      : [];
    const pointIds = points.map((p) => p.id);
    const pointTasks = pointIds.length
      ? await this.db.select().from(tasks).where(inArray(tasks.requirementPointId, pointIds))
      : [];
    const runs = await this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.projectId, projectId));
    const mats = await this.db.select().from(materials).where(eq(materials.projectId, projectId));

    const entityIds = [
      projectId,
      ...reqIds,
      ...pointIds,
      ...pointTasks.map((t) => t.id),
      ...runs.map((r) => r.id),
      ...mats.map((m) => m.id),
    ];
    const timeline = entityIds.length
      ? await this.db
          .select()
          .from(changeLogs)
          .where(inArray(changeLogs.entityId, entityIds))
          .orderBy(desc(changeLogs.createdAt))
          .limit(500)
      : [];

    const actorDistribution: Record<ActorKind, number> = { human: 0, ai: 0, mcp: 0 };
    const entityTypeDistribution: Record<string, number> = {};
    const daily = new Map<string, number>();
    for (const log of timeline) {
      actorDistribution[actorKind(log.actor)] += 1;
      entityTypeDistribution[log.entityType] = (entityTypeDistribution[log.entityType] ?? 0) + 1;
      const day = localDate(log.createdAt);
      daily.set(day, (daily.get(day) ?? 0) + 1);
    }
    const dailyCounts = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return { timeline, actorDistribution, entityTypeDistribution, dailyCounts };
  }
}
```

注:`getChangeLog` 用 entityId 单索引过滤后再按 entityType 收窄(entityId 已是 UUID 全局唯一,filter 是双保险)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/audit.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,3 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export { AuditService, type AuditReport, type ActorKind } from './services/audit.service.js';
```

```bash
git add packages/core/src/services/audit.service.ts packages/core/src/services/audit.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): AuditService 审计查询与项目审计报告聚合"
```

---

### Task 11: SettingsService(含 env 首次种子化)

**Files:**

- Create: `packages/core/src/services/settings.service.ts`
- Test: `packages/core/src/services/settings.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `settings` 表、`DomainError`、spec §10 环境变量名。
- Produces:
  - `interface LlmConfig { baseUrl: string; apiKey: string; model: string; temperature?: number; timeoutMs?: number }`
  - `class SettingsService { constructor(db: ShipmateDb); async get<T = unknown>(key: string): Promise<T | undefined>; async getOrThrow<T = unknown>(key: string, message?: string): Promise<T>; async set(key: string, value: unknown): Promise<void>; async setMany(entries: Record<string, unknown>): Promise<void>; async all(): Promise<Record<string, unknown>>; getLlmConfig(): LlmConfig; ensureSeededFromEnv(env?: NodeJS.ProcessEnv): Promise<void> }`
  - `get` 返回 jsonb 反序列化后的值;`set` upsert(onConflictDoUpdate)。
  - `getLlmConfig` 为**同步**方法:构造时一次性读齐 LLM 四项存为私有字段?——不,设置页改完要即时生效(spec §10),因此 `getLlmConfig` 改为 `async getLlmConfig(): Promise<LlmConfig>`:每次现读 `llm.base_url` / `llm.api_key` / `llm.model`,任一缺失抛 `VALIDATION_ERROR`(message 指引去设置页配置);`llm.temperature` / `llm.timeout_ms` 可选透传。
  - `ensureSeededFromEnv`:仅当 key 在 settings 表中**不存在**且 env 有值时写入(spec §10:env 仅作首次启动默认值,之后 settings 为准)。key 映射:`SHIPMATE_LLM_BASE_URL→llm.base_url`、`SHIPMATE_LLM_API_KEY→llm.api_key`、`SHIPMATE_LLM_MODEL→llm.model`。
  - 配置类写入**不**记 change_logs(spec §3.7 entity_type 枚举未含 settings,属有意为之)。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/settings.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withDb } from '../db/database.js';
import { DomainError } from '../errors.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  it('set/get 往返(对象值 jsonb 序列化);get 不存在返回 undefined', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('ui.theme', 'dark');
      await svc.set('llm.temperature', 0.3);
      await svc.set('some.obj', { a: [1, 2] });
      expect(await svc.get<string>('ui.theme')).toBe('dark');
      expect(await svc.get<number>('llm.temperature')).toBe(0.3);
      expect(await svc.get<{ a: number[] }>('some.obj')).toEqual({ a: [1, 2] });
      expect(await svc.get('missing')).toBeUndefined();
    });
  });

  it('set 覆盖旧值(upsert);getOrThrow 缺失抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('k', 1);
      await svc.set('k', 2);
      expect(await svc.get('k')).toBe(2);
      try {
        await svc.getOrThrow('nope');
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('getLlmConfig:三项齐才通过,缺一抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      await svc.set('llm.base_url', 'https://api.example.com/v1');
      await svc.set('llm.api_key', 'sk-test-placeholder');
      try {
        await svc.getLlmConfig();
        expect.unreachable('应当抛错');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
      await svc.set('llm.model', 'gpt-test');
      const cfg = await svc.getLlmConfig();
      expect(cfg).toEqual({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test-placeholder',
        model: 'gpt-test',
        temperature: undefined,
        timeoutMs: undefined,
      });
    });
  });

  it('ensureSeededFromEnv:仅首播种,settings 已有值不覆盖', async () => {
    await withDb(async (db) => {
      const svc = new SettingsService(db);
      const env = {
        SHIPMATE_LLM_BASE_URL: 'https://env.example.com/v1',
        SHIPMATE_LLM_API_KEY: 'sk-env',
        SHIPMATE_LLM_MODEL: 'm1',
      };
      await svc.ensureSeededFromEnv(env as NodeJS.ProcessEnv);
      expect(await svc.get('llm.base_url')).toBe('https://env.example.com/v1');
      // settings 已有值时 env 不覆盖
      await svc.set('llm.base_url', 'https://manual.example.com/v1');
      await svc.ensureSeededFromEnv(env as NodeJS.ProcessEnv);
      expect(await svc.get('llm.base_url')).toBe('https://manual.example.com/v1');
    });
  });
});
```

(注意:测试里的 api_key 用占位值,**不得**把任何真实密钥写进测试文件。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/settings.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/settings.service.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import { settings } from '../db/schema.js';
import { DomainError } from '../errors.js';
import type { LlmConfig } from '../llm/client.js';

export class SettingsService {
  constructor(private db: ShipmateDb) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = (await this.db.select().from(settings).where(eq(settings.key, key)))[0];
    return row ? (row.value as T) : undefined;
  }

  async getOrThrow<T = unknown>(key: string, message?: string): Promise<T> {
    const v = await this.get<T>(key);
    if (v === undefined)
      throw new DomainError('VALIDATION_ERROR', message ?? `配置项 ${key} 未设置`);
    return v;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value: value as never, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: value as never, updatedAt: Date.now() },
      });
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) await this.set(k, v);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** spec §10:LLM 接入参数,每次现读(设置页改后即时生效);配置不齐明确报错,不静默降级 */
  async getLlmConfig(): Promise<LlmConfig> {
    const baseUrl = await this.get<string>('llm.base_url');
    const apiKey = await this.get<string>('llm.api_key');
    const model = await this.get<string>('llm.model');
    if (!baseUrl || !apiKey || !model) {
      throw new DomainError(
        'VALIDATION_ERROR',
        '模型未配置:请在「设置 → 模型设置」完成 base_url / api_key / model',
      );
    }
    return {
      baseUrl,
      apiKey,
      model,
      temperature: await this.get<number>('llm.temperature'),
      timeoutMs: await this.get<number>('llm.timeout_ms'),
    };
  }

  /** spec §10:env 仅作首次启动默认值;settings 已存在的 key 不覆盖 */
  async ensureSeededFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const mapping: [string, string | undefined][] = [
      ['llm.base_url', env.SHIPMATE_LLM_BASE_URL],
      ['llm.api_key', env.SHIPMATE_LLM_API_KEY],
      ['llm.model', env.SHIPMATE_LLM_MODEL],
    ];
    for (const [key, val] of mapping) {
      if (val && (await this.get(key)) === undefined) await this.set(key, val);
    }
  }
}
```

`packages/core/src/llm/client.ts` 本任务先建**最小骨架**(仅导出类型,完整实现在 Task 12):

```ts
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/settings.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,4 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export { SettingsService } from './services/settings.service.js';
export type { LlmConfig } from './llm/client.js';
```

```bash
git add packages/core/src/services/settings.service.ts packages/core/src/services/settings.service.test.ts packages/core/src/llm/client.ts packages/core/src/index.ts
git commit -m "feat(core): SettingsService 键值配置与 env 首次种子化"
```

---

### Task 12: LLM 客户端与分析 Prompt

**Files:**

- Modify: `packages/core/src/llm/client.ts`(补全 chatJson)
- Create: `packages/core/src/llm/schema.ts`
- Create: `packages/core/src/llm/prompt.ts`
- Create: `packages/core/src/llm/prompt-types.ts`
- Test: `packages/core/src/llm/client.test.ts`

**Interfaces:**

- Consumes: `LlmConfig`、`DomainError`、`zod`。
- Produces:
  - `async function chatJson(cfg: LlmConfig, system: string, user: string): Promise<unknown>` —— POST `{baseUrl}/chat/completions`,`response_format: { type: 'json_object' }`;网络/HTTP 错误抛 `LLM_ERROR`;响应缺 content 或 content 非合法 JSON 抛 `LLM_SCHEMA_MISMATCH`;默认超时 120s(`AbortSignal.timeout`)。
  - zod schema(Task 13/14 消费):`analysisResultSchema.parse(raw)`;导出类型 `AnalysisResult / DraftRequirement / DraftPoint / DraftSupplement / DraftConflict`。
  - `buildSystemPrompt(): string`、`buildUserPrompt(materials: MaterialRow[], existing: ExistingRequirementDigest[]): string`,`type ExistingRequirementDigest = { id: string; title: string; summary: string; points: { id: string; title: string; status: string }[] }`。
  - 产物草稿结构(存 `analysis_runs.draft_result`):`{ requirements: DraftRequirement[], supplements: DraftSupplement[] }`;`DraftRequirement.conflict` 携带 `{ type: 'duplicate'|'contradiction', target_requirement_title: string, reason?: string }`。

- [ ] **Step 1: 写失败测试(mock fetch,不连网)**

`packages/core/src/llm/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../errors.js';
import { chatJson } from './client.js';
import { analysisResultSchema, type AnalysisResult } from './schema.js';
import { buildUserPrompt } from './prompt.js';
import type { MaterialRow } from '../db/schema.js';

const cfg = { baseUrl: 'https://api.test/v1', apiKey: 'sk-test', model: 'm' };

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chatJson', () => {
  it('正常返回解析后的 JSON;请求带 json_object 模式与鉴权头', async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{"ok":true}' } }] });
    const out = await chatJson(cfg, 'sys', 'usr');
    expect(out).toEqual({ ok: true });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('m');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('baseUrl 结尾斜杠被归一', async () => {
    const fn = mockFetchOnce(200, { choices: [{ message: { content: '{}' } }] });
    await chatJson({ ...cfg, baseUrl: 'https://api.test/v1///' }, 's', 'u');
    expect((fn.mock.calls[0] as unknown[])[0]).toBe('https://api.test/v1/chat/completions');
  });

  it('HTTP 500 → LLM_ERROR', async () => {
    mockFetchOnce(500, { error: 'boom' });
    try {
      await chatJson(cfg, 's', 'u');
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('LLM_ERROR');
    }
  });

  it('content 非法 JSON → LLM_SCHEMA_MISMATCH', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: '不是json' } }] });
    try {
      await chatJson(cfg, 's', 'u');
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('LLM_SCHEMA_MISMATCH');
    }
  });
});

describe('analysisResultSchema', () => {
  it('接受完整结构并补默认值', () => {
    const parsed = analysisResultSchema.parse({
      requirements: [
        {
          title: '导出',
          points: [
            {
              title: 'CSV',
              confidence: 0.9,
              evidences: [{ material_id: 'm1', quote: '要能导出' }],
            },
          ],
        },
      ],
      supplements: [],
    }) as AnalysisResult;
    expect(parsed.requirements[0]!.summary).toBe('');
    expect(parsed.requirements[0]!.conflict).toBeUndefined();
  });

  it('拒绝缺 evidences 字段的点', () => {
    expect(() =>
      analysisResultSchema.parse({
        requirements: [{ title: 'x', points: [{ title: 'p', confidence: 1 }] }],
        supplements: [],
      }),
    ).toThrow();
  });
});

describe('buildUserPrompt', () => {
  it('拼接素材与已有需求摘要', () => {
    const mat = {
      id: 'm1',
      type: 'paste_text',
      title: '会议记录',
      rawContent: '要能导出 CSV',
    } as MaterialRow;
    const text = buildUserPrompt(
      [mat],
      [
        {
          id: 'r1',
          title: '已有需求',
          summary: '摘要',
          points: [{ id: 'p1', title: '点A', status: 'done' }],
        },
      ],
    );
    expect(text).toContain('【素材 m1】');
    expect(text).toContain('要能导出 CSV');
    expect(text).toContain('已有需求');
    expect(text).toContain('点A');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/llm/client.test.ts`
Expected: FAIL(`chatJson` / `analysisResultSchema` 不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/llm/client.ts` 在已有 `LlmConfig` 接口下方追加:

```ts
import { DomainError } from '../errors.js';

/** OpenAI 兼容 /chat/completions,JSON mode;失败明确报错不静默降级(spec §7 规则) */
export async function chatJson(cfg: LlmConfig, system: string, user: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new DomainError('LLM_ERROR', `LLM 请求失败:${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DomainError('LLM_ERROR', `LLM 返回 ${res.status}:${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new DomainError('LLM_SCHEMA_MISMATCH', 'LLM 响应缺少 choices[0].message.content');
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new DomainError('LLM_SCHEMA_MISMATCH', 'LLM 返回内容不是合法 JSON');
  }
}
```

`packages/core/src/llm/schema.ts`:

```ts
import { z } from 'zod';

/** spec §9:AI 结构化产出;confidence 仅展示,不参与状态决策 */
export const evidenceSchema = z.object({
  material_id: z.string().min(1),
  quote: z.string().min(1),
});

export const draftPointSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  confidence: z.number().min(0).max(1),
  evidences: z.array(evidenceSchema),
});

export const draftConflictSchema = z.object({
  type: z.enum(['duplicate', 'contradiction']),
  target_requirement_title: z.string().min(1),
  reason: z.string().optional().default(''),
});

export const draftRequirementSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(''),
  conflict: draftConflictSchema.optional(),
  points: z.array(draftPointSchema),
});

export const draftSupplementSchema = z.object({
  target_requirement_title: z.string().min(1),
  points: z.array(draftPointSchema),
});

export const analysisResultSchema = z.object({
  requirements: z.array(draftRequirementSchema),
  supplements: z.array(draftSupplementSchema),
});

export type DraftPoint = z.infer<typeof draftPointSchema>;
export type DraftConflict = z.infer<typeof draftConflictSchema>;
export type DraftRequirement = z.infer<typeof draftRequirementSchema>;
export type DraftSupplement = z.infer<typeof draftSupplementSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
```

`packages/core/src/llm/prompt-types.ts`:

```ts
export interface ExistingRequirementDigest {
  id: string;
  title: string;
  summary: string;
  points: { id: string; title: string; status: string }[];
}
```

`packages/core/src/llm/prompt.ts`:

```ts
import type { ExistingRequirementDigest } from './prompt-types.js';
import type { MaterialRow } from '../db/schema.js';

export function buildSystemPrompt(): string {
  return `你是资深需求分析师。从素材中提炼「需求(requirement)」与「需求点(point)」,只输出 JSON,结构如下:
{
  "requirements": [
    { "title": "需求标题", "summary": "一句话摘要",
      "conflict": { "type": "duplicate 或 contradiction", "target_requirement_title": "已有需求标题", "reason": "判定原因" },
      "points": [
        { "title": "需求点标题", "description": "描述", "confidence": 0.0,
          "evidences": [ { "material_id": "素材ID", "quote": "原文引用段落" } ] } ] }
  ],
  "supplements": [
    { "target_requirement_title": "已有需求标题", "points": [ 同上 ] }
  ]
}
规则:
1. 每个需求点必须尽量给出 evidences,引用素材原文段落并标注素材ID;确无原文依据时 evidences 给空数组,禁止编造
2. 与「已有需求」中的需求实质重复时,加 conflict 且 type=duplicate;结论相悖时 type=contradiction
3. 素材是对已有需求的补充(只新增需求点)时,放入 supplements,不新建需求
4. 全新需求放 requirements,不带 conflict 字段
5. 只输出 JSON,不输出任何其他文字`;
}

export function buildUserPrompt(
  materials: MaterialRow[],
  existing: ExistingRequirementDigest[],
): string {
  const materialSection = materials
    .map((m) => `【素材 ${m.id}】(${m.type}${m.title ? `,${m.title}` : ''})\n${m.rawContent}`)
    .join('\n\n');
  const existingSection = existing.length
    ? existing
        .map(
          (r) =>
            `- ${r.title}(${r.id}):${r.summary || '(无摘要)'} | 需求点:${r.points.map((p) => p.title).join('、') || '无'}`,
        )
        .join('\n')
    : '(暂无已有需求)';
  return `## 已有需求(用于判断重复/相悖/补充)\n${existingSection}\n\n## 待分析素材\n${materialSection}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/llm/client.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,7 个用例。(测试从 `./client.js`、`./schema.js`、`./prompt.js` 三个文件分别导入,与实现文件拆分对应。)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm packages/core/src/llm/client.test.ts
git commit -m "feat(core): OpenAI 兼容 LLM 客户端、分析产出 schema 与 prompt 构建"
```

---

### Task 13: AnalysisService —— 批次/素材 CRUD 与开始分析

**Files:**

- Create: `packages/core/src/services/analysis.service.ts`
- Test: `packages/core/src/services/analysis.service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `writeChangeLog`、`DomainError`、`withDb`、`analysisRuns/materials/requirements/requirementPoints/projects` 表、`chatJson`、`analysisResultSchema`、`buildSystemPrompt/buildUserPrompt`、`SettingsService`。
- Produces:
  - `type LlmInvoker = (system: string, user: string) => Promise<unknown>`(测试注入 fake;生产由 `createAnalysisService` 组装)
  - `type AnalysisRunSummary = AnalysisRunRow & { materialCount: number; draftRequirementCount: number }`(draftRequirementCount = 草稿 requirements + supplements 数;无草稿为 0)
  - `type AnalysisRunDetail = { run: AnalysisRunRow; materials: MaterialRow[] }`
  - `class AnalysisService { constructor(db: ShipmateDb, llm: LlmInvoker); async createAnalysisRun(input: { projectId: string; title?: string }, actor: Actor): Promise<AnalysisRunRow>; async addMaterial(input: { runId: string; type: 'paste_text'|'screenshot_text'|'doc'; title?: string; rawContent: string }, actor: Actor): Promise<MaterialRow>; async startAnalysis(runId: string, actor: Actor): Promise<AnalysisRunRow>; async listAnalysisRuns(projectId: string, filter?: { status?: 'pending'|'done'|'failed' }): Promise<AnalysisRunSummary[]>; async getAnalysisRun(id: string): Promise<AnalysisRunDetail>; applyAnalysisRun(...) /* Task 14 */ }`
  - `function createAnalysisService(db: ShipmateDb): AnalysisService`(生产工厂:内部用 SettingsService 读配置 + chatJson;配置缺失抛 `VALIDATION_ERROR`)
  - 行为要点:
    - `createAnalysisRun`:title 缺省取 `素材分析 MM-DD HH:mm`(本地时间);run 记 `create` ChangeLog。
    - `addMaterial`:run 不存在抛 `NOT_FOUND`;run 状态不限(pending/done/failed 均可补素材再重析);记 `create` ChangeLog。
    - `startAnalysis`(spec §9):空素材抛 `VALIDATION_ERROR`;LLM 调用 + `analysisResultSchema.safeParse`;成功 → run `status='done'` + `draftResult` + `completedAt`,写 `status_change` ChangeLog(**afterSnapshot 剔除 draftResult**,避免审计膨胀);LLM/schema 失败 → run `status='failed'`(写 `status_change`)并按原错误码 rethrow(`LLM_ERROR` / `LLM_SCHEMA_MISMATCH`)。
    - 注入已有需求摘要:项目内全部 requirements + 各自 points(title/status)喂给 prompt。
  - 错误:项目不存在 `NOT_FOUND`。

- [ ] **Step 1: 写失败测试**

`packages/core/src/services/analysis.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { analysisRuns, changeLogs, projects } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { AnalysisService, type LlmInvoker } from './analysis.service.js';

function makeService(db: ShipmateDb, llm: LlmInvoker) {
  return new AnalysisService(db, llm);
}

describe('批次与素材', () => {
  it('createAnalysisRun:默认标题 + create log', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      expect(run).toMatchObject({ projectId: p.id, status: 'pending' });
      expect(run.title).toMatch(/^素材分析 \d{2}-\d{2} \d{2}:\d{2}$/);
      expect(
        await db.select().from(changeLogs).where(eq(changeLogs.entityId, run.id)),
      ).toHaveLength(1);
    });
  });

  it('addMaterial:落库 + create log;run 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      const m = await svc.addMaterial(
        { runId: run.id, type: 'paste_text', title: '会议记录', rawContent: '要能导出 CSV' },
        'human',
      );
      expect(m).toMatchObject({ analysisRunId: run.id, projectId: p.id, type: 'paste_text' });
      try {
        await svc.addMaterial({ runId: 'missing', type: 'doc', rawContent: 'x' }, 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listAnalysisRuns / getAnalysisRun 汇总素材与草稿计数', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({
        requirements: [{ title: 'R1', points: [{ title: 'p', confidence: 0.9, evidences: [] }] }],
        supplements: [{ target_requirement_title: '旧需求', points: [] }],
      }));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材一' }, 'human');
      await svc.addMaterial({ runId: run.id, type: 'doc', rawContent: '素材二' }, 'human');

      expect((await svc.listAnalysisRuns(p.id))[0]).toMatchObject({
        materialCount: 2,
        draftRequirementCount: 0,
      });

      await svc.startAnalysis(run.id, 'human');
      const summary = (await svc.listAnalysisRuns(p.id))[0]!;
      expect(summary).toMatchObject({ status: 'done', materialCount: 2, draftRequirementCount: 2 });

      const detail = await svc.getAnalysisRun(run.id);
      expect(detail.materials).toHaveLength(2);
      expect((detail.run.draftResult as { requirements: unknown[] }).requirements).toHaveLength(1);
    });
  });

  it('listAnalysisRuns:status 过滤', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({ requirements: [], supplements: [] }));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const r1 = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.startAnalysis(r1.id, 'human');
      expect(await svc.listAnalysisRuns(p.id, { status: 'done' })).toHaveLength(1);
      expect(await svc.listAnalysisRuns(p.id, { status: 'pending' })).toHaveLength(1);
    });
  });
});

describe('startAnalysis', () => {
  it('空素材抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      try {
        await svc.startAnalysis(run.id, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('LLM 失败 → run 置 failed 并抛 LLM_ERROR;再次分析成功可恢复为 done 并覆盖草稿', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');

      const fail = makeService(db, async () => {
        throw new DomainError('LLM_ERROR', '超时');
      });
      await expect(fail.startAnalysis(run.id, 'human')).rejects.toMatchObject({
        code: 'LLM_ERROR',
      });
      expect(
        (await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status,
      ).toBe('failed');

      const ok = makeService(db, async () => ({
        requirements: [{ title: '新草稿', points: [] }],
        supplements: [],
      }));
      const done = await ok.startAnalysis(run.id, 'human');
      expect(done.status).toBe('done');
      expect(
        (done.draftResult as { requirements: { title: string }[] }).requirements[0]!.title,
      ).toBe('新草稿');
    });
  });

  it('LLM 产出不合 schema → LLM_SCHEMA_MISMATCH 且 run failed', async () => {
    await withDb(async (db) => {
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const setup = makeService(db, async () => ({}));
      const run = await setup.createAnalysisRun({ projectId: p.id }, 'human');
      await setup.addMaterial({ runId: run.id, type: 'paste_text', rawContent: '素材' }, 'human');
      const bad = makeService(db, async () => ({ wrong: 'shape' }));
      await expect(bad.startAnalysis(run.id, 'human')).rejects.toMatchObject({
        code: 'LLM_SCHEMA_MISMATCH',
      });
      expect(
        (await db.select().from(analysisRuns).where(eq(analysisRuns.id, run.id)))[0]!.status,
      ).toBe('failed');
    });
  });

  it('成功路径:llm 收到的 user prompt 含素材原文;status_change log 剔除草稿正文', async () => {
    await withDb(async (db) => {
      const llm = vi.fn(async () => ({ requirements: [], supplements: [] }));
      const svc = makeService(db, llm);
      const now = Date.now();
      const p = (
        await db
          .insert(projects)
          .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
          .returning()
      )[0]!;
      const run = await svc.createAnalysisRun({ projectId: p.id }, 'human');
      await svc.addMaterial(
        { runId: run.id, type: 'paste_text', rawContent: '独有素材标记XYZ' },
        'human',
      );
      await svc.startAnalysis(run.id, 'ai:analysis');
      expect(llm).toHaveBeenCalledTimes(1);
      expect(String(llm.mock.calls[0]![1])).toContain('独有素材标记XYZ');

      const log = (await db.select().from(changeLogs).where(eq(changeLogs.entityId, run.id))).find(
        (l) => l.changeType === 'status_change',
      )!;
      expect(JSON.stringify(log.afterSnapshot)).not.toContain('requirements');
    });
  });

  it('run 不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = makeService(db, async () => ({}));
      await expect(svc.startAnalysis('missing', 'human')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/analysis.service.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`packages/core/src/services/analysis.service.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { ShipmateDb } from '../db/database.js';
import {
  analysisRuns,
  materials,
  projects,
  requirementPoints,
  requirements,
  type AnalysisRunRow,
  type MaterialRow,
} from '../db/schema.js';
import { newId } from '../db/id.js';
import type { Actor } from '../types.js';
import { DomainError } from '../errors.js';
import { writeChangeLog } from './change-log.js';
import { SettingsService } from './settings.service.js';
import { chatJson, type LlmConfig } from '../llm/client.js';
import { analysisResultSchema, type AnalysisResult } from '../llm/schema.js';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompt.js';
import type { ExistingRequirementDigest } from '../llm/prompt-types.js';

export type LlmInvoker = (system: string, user: string) => Promise<unknown>;

export interface AnalysisRunSummary extends AnalysisRunRow {
  materialCount: number;
  draftRequirementCount: number;
}

export interface AnalysisRunDetail {
  run: AnalysisRunRow;
  materials: MaterialRow[];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function defaultRunTitle(now = new Date()): string {
  return `素材分析 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function withoutDraft(run: AnalysisRunRow): AnalysisRunRow {
  return { ...run, draftResult: null };
}

function draftCount(draft: AnalysisResult | null): number {
  if (!draft) return 0;
  return draft.requirements.length + draft.supplements.length;
}

export class AnalysisService {
  constructor(
    private db: ShipmateDb,
    private llm: LlmInvoker,
  ) {}

  async createAnalysisRun(
    input: { projectId: string; title?: string },
    actor: Actor,
  ): Promise<AnalysisRunRow> {
    return this.db.transaction(async (tx) => {
      if (!(await tx.select().from(projects).where(eq(projects.id, input.projectId)))) {
        throw new DomainError('NOT_FOUND', `项目 ${input.projectId} 不存在`);
      }
      const now = Date.now();
      const rows = await tx
        .insert(analysisRuns)
        .values({
          id: newId(),
          projectId: input.projectId,
          title: input.title?.trim() || defaultRunTitle(),
          status: 'pending',
          actor,
          createdAt: now,
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'analysis_run',
        entityId: row.id,
        changeType: 'create',
        after: withoutDraft(row),
        actor,
      });
      return row;
    });
  }

  async addMaterial(
    input: { runId: string; type: MaterialRow['type']; title?: string; rawContent: string },
    actor: Actor,
  ): Promise<MaterialRow> {
    if (!input.rawContent?.trim()) throw new DomainError('VALIDATION_ERROR', '素材内容不能为空');
    return this.db.transaction(async (tx) => {
      const run = (await tx.select().from(analysisRuns).where(eq(analysisRuns.id, input.runId)))[0];
      if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${input.runId} 不存在`);
      const rows = await tx
        .insert(materials)
        .values({
          id: newId(),
          projectId: run.projectId,
          analysisRunId: run.id,
          type: input.type,
          title: input.title ?? null,
          rawContent: input.rawContent,
          actor,
          createdAt: Date.now(),
        })
        .returning();
      const row = rows[0]!;
      await writeChangeLog(tx, {
        entityType: 'material',
        entityId: row.id,
        changeType: 'create',
        after: row,
        actor,
      });
      return row;
    });
  }

  /** spec §9 主链路:汇集素材 → LLM 结构化输出 → 草稿暂存 Run(不落业务表) */
  async startAnalysis(runId: string, actor: Actor): Promise<AnalysisRunRow> {
    const run = (await this.db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0];
    if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${runId} 不存在`);
    const mats = await this.db.select().from(materials).where(eq(materials.analysisRunId, runId));
    if (mats.length === 0) throw new DomainError('VALIDATION_ERROR', '批次内没有素材,请先添加素材');

    const existing = await this.collectExistingDigest(run.projectId);
    const user = buildUserPrompt(mats, existing);
    const system = buildSystemPrompt();

    try {
      const raw = await this.llm(system, user);
      const parsed = this.parseResult(raw);
      return await this.db.transaction(async (tx) => {
        const updated = (
          await tx
            .update(analysisRuns)
            .set({ status: 'done', draftResult: parsed as never, completedAt: Date.now() })
            .where(eq(analysisRuns.id, runId))
            .returning()
        )[0]!;
        await writeChangeLog(tx, {
          entityType: 'analysis_run',
          entityId: runId,
          changeType: 'status_change',
          before: { ...run, draftResult: null },
          after: withoutDraft(updated),
          reason: 'AI 分析完成,产出草稿已暂存',
          actor,
        });
        return updated;
      });
    } catch (e) {
      if (
        e instanceof DomainError &&
        (e.code === 'LLM_ERROR' || e.code === 'LLM_SCHEMA_MISMATCH')
      ) {
        await this.markFailed(runId, actor, e.message);
        throw e;
      }
      if (e instanceof Error && e.name === 'ZodError') {
        const msg = `LLM 产出不合 schema:${e.message.slice(0, 200)}`;
        await this.markFailed(runId, actor, msg);
        throw new DomainError('LLM_SCHEMA_MISMATCH', msg);
      }
      throw e;
    }
  }

  async listAnalysisRuns(
    projectId: string,
    filter?: { status?: AnalysisRunRow['status'] },
  ): Promise<AnalysisRunSummary[]> {
    const rows = await this.db
      .select()
      .from(analysisRuns)
      .where(
        filter?.status
          ? and(eq(analysisRuns.projectId, projectId), eq(analysisRuns.status, filter.status))
          : eq(analysisRuns.projectId, projectId),
      )
      .orderBy(desc(analysisRuns.createdAt));
    const allMats = await this.db
      .select()
      .from(materials)
      .where(eq(materials.projectId, projectId));
    return rows.map((r) => ({
      ...r,
      materialCount: allMats.filter((m) => m.analysisRunId === r.id).length,
      draftRequirementCount: draftCount(r.draftResult as AnalysisResult | null),
    }));
  }

  async getAnalysisRun(id: string): Promise<AnalysisRunDetail> {
    const run = (await this.db.select().from(analysisRuns).where(eq(analysisRuns.id, id)))[0];
    if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${id} 不存在`);
    const mats = await this.db.select().from(materials).where(eq(materials.analysisRunId, id));
    return { run, materials: mats };
  }

  private parseResult(raw: unknown): AnalysisResult {
    const parsed = analysisResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError(
        'LLM_SCHEMA_MISMATCH',
        `LLM 产出不合 schema:${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
      );
    }
    return parsed.data;
  }

  private async markFailed(runId: string, actor: Actor, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = (
        await tx
          .update(analysisRuns)
          .set({ status: 'failed', completedAt: Date.now() })
          .where(eq(analysisRuns.id, runId))
          .returning()
      )[0];
      if (updated) {
        await writeChangeLog(tx, {
          entityType: 'analysis_run',
          entityId: runId,
          changeType: 'status_change',
          after: withoutDraft(updated),
          reason,
          actor,
        });
      }
    });
  }

  private async collectExistingDigest(projectId: string): Promise<ExistingRequirementDigest[]> {
    const reqs = await this.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, projectId));
    return Promise.all(
      reqs.map(async (r) => {
        const pts = await this.db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, r.id));
        return {
          id: r.id,
          title: r.title,
          summary: r.summary ?? '',
          points: pts.map((p) => ({ id: p.id, title: p.title, status: p.status })),
        };
      }),
    );
  }
}

/** 生产工厂:LLM 配置来自 settings 表(含 env 首次种子化后的值) */
export function createAnalysisService(db: ShipmateDb): AnalysisService {
  const settings = new SettingsService(db);
  return new AnalysisService(db, async (system, user) => {
    const cfg: LlmConfig = await settings.getLlmConfig();
    return chatJson(cfg, system, user);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -C packages/core test src/services/analysis.service.test.ts && pnpm -C packages/core typecheck`
Expected: PASS,9 个用例。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 追加:

```ts
export {
  AnalysisService,
  createAnalysisService,
  type LlmInvoker,
  type AnalysisRunSummary,
} from './services/analysis.service.js';
export { analysisResultSchema, type AnalysisResult } from './llm/schema.js';
```

```bash
git add packages/core/src/services/analysis.service.ts packages/core/src/services/analysis.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): 分析批次服务——素材录入与 AI 分析草稿暂存"
```

---

### Task 14: AnalysisService.applyAnalysisRun(冲突三分类应用)

**Files:**

- Modify: `packages/core/src/services/analysis.service.ts`(追加 apply 相关)
- Test: `packages/core/src/services/analysis.service.test.ts`(追加 describe 块)

**Interfaces:**

- Consumes: Task 13 全部、`DraftRequirement/DraftPoint`、`writeChangeLog`、`withDb`。
- Produces:
  - `type ConflictResolution = 'merge' | 'create_anyway' | 'skip' | 'use_new' | 'use_old' | 'keep_both'`
  - `type ConflictDecision = { requirementTitle: string; resolution: ConflictResolution }`(按草稿块 title 定位;草稿未落库无 id)
  - `async applyAnalysisRun(runId: string, options?: { selectedRequirements?: string[]; selectedSupplements?: string[]; decisions?: ConflictDecision[] }, actor?: Actor): Promise<RequirementRow[]>`
  - 行为规则(spec §9 规则 8,**全部单事务,要么全成要么全不动**):
    - 无草稿抛 `VALIDATION_ERROR`(提示先 start_analysis)。
    - `selectedRequirements` 缺省 = 全选;按草稿块 title 匹配。
    - **普通块**:新建 Requirement(draft)+ Points(draft;sourceMaterialIds 取 evidences 素材 id 去重;origin='analysis');requirement 与每个 point 各写 `create` ChangeLog。
    - **duplicate 块**:无 decision 默认 `merge`。`merge` → 按 `conflict.target_requirement_title` 找已有需求,逐点匹配 title:匹配到 → evidences 追加 + sourceMaterialIds 合并,写 `update` ChangeLog;未匹配到 → 该点作为新点(origin='analysis')追加进已有需求。找不到目标需求 → 退化为普通新建。`create_anyway` → 新建,且新点与目标需求全部已有点双向记 `relations { type:'duplicate', point_id }`。`skip` → 不落库,写 `analysis_run` 上 `discard` ChangeLog(afterSnapshot = 草稿块)。
    - **contradiction 块**:选中块若无 decision → 整个 apply 抛 `VALIDATION_ERROR`(details 列出全部未裁决 title,强制人工裁决)。`use_new` → 新建 + 目标需求下所有任务置 needs_reassessment(各写 `status_change`,已是该状态跳过)。`use_old` → 不落库,写 `discard` ChangeLog。`keep_both` → 新建,新点与目标需求全部已有点双向记 `relations { type:'conflict', point_id }`。
    - **supplement 块**:`selectedSupplements` 缺省全选;按 `target_requirement_title` 找已有需求:找到 → 仅追加新点(origin='supplement'),已有点不动;找不到 → 该补充退化为普通新建需求。
    - 决策的 resolution 与块冲突类型不匹配(如给 contradiction 块传 merge)抛 `VALIDATION_ERROR`。
    - 返回本次**新建**的 RequirementRow 数组(supplement 追加点不产生新需求,不入返回)。

- [ ] **Step 1: 写失败测试(追加到 analysis.service.test.ts 末尾)**

```ts
import { requirements, requirementPoints } from '../db/schema.js'; // 并入文件顶部已有 schema 导入行
import { TaskService } from './task.service.js';

describe('applyAnalysisRun', () => {
  const goodDraft = {
    requirements: [
      {
        title: '全新需求A',
        summary: 'A 摘要',
        points: [
          {
            title: 'A1',
            description: '',
            confidence: 0.9,
            evidences: [{ material_id: 'm-ghost', quote: '原文' }],
          },
        ],
      },
      {
        title: '重复块B',
        summary: '',
        conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '同口径' },
        points: [
          {
            title: 'X1',
            description: '',
            confidence: 0.8,
            evidences: [{ material_id: 'm2', quote: '补充原文' }],
          },
        ],
      },
      {
        title: '相悖块C',
        summary: '',
        conflict: {
          type: 'contradiction',
          target_requirement_title: '已有需求X',
          reason: '结论相反',
        },
        points: [{ title: 'C1', description: '', confidence: 0.7, evidences: [] }],
      },
    ],
    supplements: [
      {
        target_requirement_title: '已有需求X',
        points: [{ title: '补充点S', description: '', confidence: 0.85, evidences: [] }],
      },
    ],
  };

  async function seedProject(db: ShipmateDb): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(projects)
        .values({ id: newId(), name: 'P', status: 'active', createdAt: now, updatedAt: now })
        .returning()
    )[0]!.id;
  }

  async function seedDraft(db: ShipmateDb, projectId: string, draft: unknown): Promise<string> {
    const now = Date.now();
    return (
      await db
        .insert(analysisRuns)
        .values({
          id: newId(),
          projectId,
          title: '批次',
          status: 'done',
          actor: 'human',
          draftResult: draft as never,
          createdAt: now,
          completedAt: now,
        })
        .returning()
    )[0]!.id;
  }

  async function seedExistingX(
    db: ShipmateDb,
    projectId: string,
    withTask = false,
  ): Promise<string> {
    const now = Date.now();
    const req = (
      await db
        .insert(requirements)
        .values({
          id: newId(),
          projectId,
          title: '已有需求X',
          status: 'confirmed',
          priority: 'P1',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    const point = (
      await db
        .insert(requirementPoints)
        .values({
          id: newId(),
          requirementId: req.id,
          title: 'X1',
          status: 'confirmed',
          version: 1,
          sourceMaterialIds: ['m1'],
          evidences: [{ material_id: 'm1', quote: '旧原文' }],
          origin: 'manual',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    if (withTask) {
      const taskSvc = new TaskService(db);
      await taskSvc.createTask({ requirementPointId: point.id, title: 'X 的任务' }, 'human');
    }
    return req.id;
  }

  it('无草稿抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const svc = makeService(db, async () => ({}));
      const empty = await svc.createAnalysisRun({ projectId }, 'human');
      try {
        await svc.applyAnalysisRun(empty.id, undefined, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  it('普通块:落库 draft、溯源回填、create log', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[0]],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ title: '全新需求A', status: 'draft', priority: 'P2' });
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, created[0]!.id));
      expect(points[0]).toMatchObject({
        status: 'draft',
        origin: 'analysis',
        sourceMaterialIds: ['m-ghost'],
      });
      expect(points[0]!.evidences).toEqual([{ material_id: 'm-ghost', quote: '原文' }]);
    });
  });

  it('selectedRequirements 过滤:只应用选中块', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const svc = makeService(db, async () => ({}));
      const runId = await seedDraft(db, projectId, {
        requirements: [
          { title: '块一', points: [] },
          { title: '块二', points: [] },
        ],
        supplements: [],
      });
      const created = await svc.applyAnalysisRun(
        runId,
        { selectedRequirements: ['块一'] },
        'human',
      );
      expect(created.map((r) => r.title)).toEqual(['块一']);
    });
  });

  it('duplicate 默认 merge:目标点 evidences 追加,无匹配点的草稿点作为新点追加', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [
          {
            title: '重复块B',
            summary: '',
            conflict: { type: 'duplicate', target_requirement_title: '已有需求X', reason: '' },
            points: [
              {
                title: 'X1',
                description: '',
                confidence: 0.8,
                evidences: [{ material_id: 'm2', quote: '补充原文' }],
              },
              { title: '全新点Y', description: '', confidence: 0.8, evidences: [] },
            ],
          },
        ],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0); // merge 不新建需求
      const xReq = (await db.select().from(requirements)).find((r) => r.title === '已有需求X')!;
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xReq.id));
      const merged = points.find((p) => p.title === 'X1')!;
      expect(merged.evidences).toHaveLength(2); // 旧 + 新
      expect(merged.sourceMaterialIds).toEqual(['m1', 'm2']);
      expect(points.find((p) => p.title === '全新点Y')).toBeDefined();
    });
  });

  it('duplicate create_anyway:新建 + 双向 duplicate relations', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[1]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '重复块B', resolution: 'create_anyway' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoint = (
        await db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, created[0]!.id))
      )[0]!;
      const oldPoints = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xId));
      expect(newPoint.relations).toEqual([{ type: 'duplicate', point_id: oldPoints[0]!.id }]);
      expect(oldPoints[0]!.relations).toEqual([{ type: 'duplicate', point_id: newPoint.id }]);
    });
  });

  it('contradiction 未裁决 → 整批 VALIDATION_ERROR,不落任何数据', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const beforeCount = (await db.select().from(requirements)).length;
      const runId = await seedDraft(db, projectId, goodDraft);
      const svc = makeService(db, async () => ({}));
      try {
        await svc.applyAnalysisRun(runId, undefined, 'human');
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
        expect((e as DomainError).message).toContain('相悖块C');
      }
      expect((await db.select().from(requirements)).length).toBe(beforeCount);
    });
  });

  it('contradiction use_old:草稿丢弃 + discard log;use_new:旧需求任务打 needs_reassessment', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId, true);
      const svc = makeService(db, async () => ({}));

      const run1 = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const created1 = await svc.applyAnalysisRun(
        run1,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_old' }] },
        'human',
      );
      expect(created1).toHaveLength(0);
      expect(
        await db.select().from(changeLogs).where(eq(changeLogs.changeType, 'discard')),
      ).toHaveLength(1);

      const run2 = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const created2 = await svc.applyAnalysisRun(
        run2,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'use_new' }] },
        'human',
      );
      expect(created2).toHaveLength(1);
      const allTasks = await new TaskService(db).listTasks({});
      expect(allTasks.every((t) => t.status === 'needs_reassessment')).toBe(true);
    });
  });

  it('keep_both:双向 conflict relations', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(
        runId,
        { decisions: [{ requirementTitle: '相悖块C', resolution: 'keep_both' }] },
        'human',
      );
      expect(created).toHaveLength(1);
      const newPoint = (
        await db
          .select()
          .from(requirementPoints)
          .where(eq(requirementPoints.requirementId, created[0]!.id))
      )[0]!;
      const oldPoint = (
        await db.select().from(requirementPoints).where(eq(requirementPoints.requirementId, xId))
      )[0]!;
      expect(newPoint.relations).toEqual([{ type: 'conflict', point_id: oldPoint!.id }]);
      expect(oldPoint!.relations).toEqual([{ type: 'conflict', point_id: newPoint.id }]);
    });
  });

  it('supplement:仅追加新点(origin=supplement),已有点不动', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      const xId = await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [],
        supplements: goodDraft.supplements,
      });
      const svc = makeService(db, async () => ({}));
      const created = await svc.applyAnalysisRun(runId, undefined, 'human');
      expect(created).toHaveLength(0);
      const points = await db
        .select()
        .from(requirementPoints)
        .where(eq(requirementPoints.requirementId, xId));
      expect(points).toHaveLength(2);
      expect(points.find((p) => p.title === '补充点S')).toMatchObject({
        origin: 'supplement',
        status: 'draft',
      });
      expect(points.find((p) => p.title === 'X1')).toMatchObject({
        status: 'confirmed',
        evidences: [{ material_id: 'm1', quote: '旧原文' }],
      });
    });
  });

  it('resolution 与冲突类型不匹配抛 VALIDATION_ERROR', async () => {
    await withDb(async (db) => {
      const projectId = await seedProject(db);
      await seedExistingX(db, projectId);
      const runId = await seedDraft(db, projectId, {
        requirements: [goodDraft.requirements[2]!],
        supplements: [],
      });
      const svc = makeService(db, async () => ({}));
      try {
        await svc.applyAnalysisRun(
          runId,
          { decisions: [{ requirementTitle: '相悖块C', resolution: 'merge' }] },
          'human',
        );
        expect.unreachable('应当抛 VALIDATION_ERROR');
      } catch (e) {
        expect((e as DomainError).code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -C packages/core test src/services/analysis.service.test.ts`
Expected: 新增用例 FAIL(`applyAnalysisRun is not a function`),Task 13 用例仍 PASS。

- [ ] **Step 3: 实现(追加到 AnalysisService 类内)**

```ts
  /**
   * spec §9 规则 8 + §8 apply_analysis_run:
   * 选中草稿块事务落库;重复默认并入;相悖强制人工裁决;补充仅追加新点。
   */
  async applyAnalysisRun(
    runId: string,
    options?: { selectedRequirements?: string[]; selectedSupplements?: string[]; decisions?: ConflictDecision[] },
    actor: Actor = 'human',
  ): Promise<RequirementRow[]> {
    return this.db.transaction(async (tx): Promise<RequirementRow[]> => {
      const run = (await tx.select().from(analysisRuns).where(eq(analysisRuns.id, runId)))[0];
      if (!run) throw new DomainError('NOT_FOUND', `分析批次 ${runId} 不存在`);
      const draft = run.draftResult as AnalysisResult | null;
      if (!draft) throw new DomainError('VALIDATION_ERROR', '该批次没有分析草稿,请先 start_analysis');

      const decisionMap = new Map((options?.decisions ?? []).map((d) => [d.requirementTitle, d.resolution]));
      const picked = (title: string) => !options?.selectedRequirements || options.selectedRequirements.includes(title);

      // 冲突类型与决策合法性 + 相悖强制裁决前置校验(避免半途失败)
      const unresolved: string[] = [];
      for (const block of draft.requirements) {
        if (!picked(block.title)) continue;
        const decision = decisionMap.get(block.title);
        if (block.conflict?.type === 'contradiction') {
          if (!decision) unresolved.push(block.title);
          else if (!['use_new', 'use_old', 'keep_both'].includes(decision)) {
            throw new DomainError('VALIDATION_ERROR', `相悖块「${block.title}」的处置只能是 use_new/use_old/keep_both`);
          }
        } else if (block.conflict?.type === 'duplicate' && decision && !['merge', 'create_anyway', 'skip'].includes(decision)) {
          throw new DomainError('VALIDATION_ERROR', `重复块「${block.title}」的处置只能是 merge/create_anyway/skip`);
        }
      }
      if (unresolved.length > 0) {
        throw new DomainError('VALIDATION_ERROR', `相悖块必须人工裁决:${unresolved.join('、')}`, { unresolved });
      }

      const created: RequirementRow[] = [];

      for (const block of draft.requirements) {
        if (!picked(block.title)) continue;
        const conflict = block.conflict;
        const decision = decisionMap.get(block.title);

        if (conflict?.type === 'contradiction') {
          const resolution = decision as 'use_new' | 'use_old' | 'keep_both';
          const target = await this.findByTitleWithinTx(tx, run.projectId, conflict.target_requirement_title);
          if (resolution === 'use_old') {
            await this.writeDiscardLog(tx, runId, block, `相悖裁决:采用已有需求,放弃草稿「${block.title}」`, actor);
            continue;
          }
          const req = await this.insertDraftRequirement(tx, run, block, actor);
          if (resolution === 'keep_both' && target) {
            await this.linkRelations(tx, req.id, target.id, 'conflict');
          }
          if (resolution === 'use_new' && target) {
            await this.reassessTargetTasks(tx, target.id, block.title, actor);
          }
          created.push(req);
          continue;
        }

        if (conflict?.type === 'duplicate') {
          const resolution = decision ?? 'merge';
          if (resolution === 'skip') {
            await this.writeDiscardLog(tx, runId, block, `重复块跳过:「${block.title}」`, actor);
            continue;
          }
          const target = await this.findByTitleWithinTx(tx, run.projectId, conflict.target_requirement_title);
          if (resolution === 'merge' && target) {
            await this.mergeIntoRequirement(tx, target.id, block, actor);
            continue;
          }
          const req = await this.insertDraftRequirement(tx, run, block, actor);
          if (target) await this.linkRelations(tx, req.id, target.id, 'duplicate');
          created.push(req);
          continue;
        }

        created.push(await this.insertDraftRequirement(tx, run, block, actor));
      }

      for (const supp of draft.supplements) {
        if (options?.selectedSupplements && !options.selectedSupplements.includes(supp.target_requirement_title)) continue;
        const target = await this.findByTitleWithinTx(tx, run.projectId, supp.target_requirement_title);
        if (target) {
          for (const p of supp.points) await this.insertDraftPoint(tx, target.id, p, 'supplement', actor);
        } else {
          created.push(
            await this.insertDraftRequirement(
              tx,
              run,
              { title: supp.target_requirement_title, summary: '', points: supp.points },
              actor,
            ),
          );
        }
      }

      return created;
    });
  }

  private async findByTitleWithinTx(tx: ShipmateTx, projectId: string, title: string): Promise<RequirementRow | undefined> {
    return (
      await tx
        .select()
        .from(requirements)
        .where(and(eq(requirements.projectId, projectId), eq(requirements.title, title)))
    )[0];
  }

  private async writeDiscardLog(tx: ShipmateTx, runId: string, block: unknown, reason: string, actor: Actor): Promise<void> {
    await writeChangeLog(tx, { entityType: 'analysis_run', entityId: runId, changeType: 'discard', after: block, reason, actor });
  }

  private async insertDraftRequirement(tx: ShipmateTx, run: AnalysisRunRow, block: DraftRequirement, actor: Actor): Promise<RequirementRow> {
    const now = Date.now();
    const req = (
      await tx
        .insert(requirements)
        .values({
          id: newId(),
          projectId: run.projectId,
          title: block.title,
          summary: block.summary || null,
          status: 'draft',
          priority: 'P2',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    for (const p of block.points) await this.insertDraftPoint(tx, req.id, p, 'analysis', actor);
    await writeChangeLog(tx, {
      entityType: 'requirement',
      entityId: req.id,
      changeType: 'create',
      after: req,
      reason: `分析批次应用:${run.title ?? run.id}`,
      actor,
    });
    return req;
  }

  private async insertDraftPoint(
    tx: ShipmateTx,
    requirementId: string,
    p: DraftPoint,
    origin: 'analysis' | 'supplement',
    actor: Actor,
  ): Promise<RequirementPointRow> {
    const now = Date.now();
    const row = (
      await tx
        .insert(requirementPoints)
        .values({
          id: newId(),
          requirementId,
          title: p.title,
          description: p.description || null,
          status: 'draft',
          version: 1,
          sourceMaterialIds: [...new Set(p.evidences.map((e) => e.material_id))],
          evidences: p.evidences,
          origin,
          relations: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    await writeChangeLog(tx, { entityType: 'requirement_point', entityId: row.id, changeType: 'create', after: row, actor });
    return row;
  }

  /** 新需求全部点与目标需求全部点双向记 relations */
  private async linkRelations(tx: ShipmateTx, newRequirementId: string, targetRequirementId: string, type: 'duplicate' | 'conflict'): Promise<void> {
    const newPoints = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, newRequirementId));
    const targetPoints = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId));
    for (const np of newPoints) {
      for (const tp of targetPoints) {
        await tx.update(requirementPoints)
          .set({ relations: [...(np.relations ?? []), { type, point_id: tp.id }] })
          .where(eq(requirementPoints.id, np.id));
        await tx.update(requirementPoints)
          .set({ relations: [...(tp.relations ?? []), { type, point_id: np.id }] })
          .where(eq(requirementPoints.id, tp.id));
      }
    }
  }

  /** 相悖裁决 use_new:目标需求下全部任务打 needs_reassessment(spec 规则 8) */
  private async reassessTargetTasks(tx: ShipmateTx, targetRequirementId: string, newTitle: string, actor: Actor): Promise<void> {
    const pointIds = (
      await tx.select({ id: requirementPoints.id }).from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId))
    ).map((r) => r.id);
    if (pointIds.length === 0) return;
    const affected = await tx
      .update(tasks)
      .set({ status: 'needs_reassessment', updatedAt: Date.now() })
      .where(and(inArray(tasks.requirementPointId, pointIds), ne(tasks.status, 'needs_reassessment')))
      .returning();
    for (const t of affected) {
      await writeChangeLog(tx, {
        entityType: 'task',
        entityId: t.id,
        changeType: 'status_change',
        after: t,
        reason: `相悖裁决:采用新需求「${newTitle}」,旧任务待重估`,
        actor,
      });
    }
  }

  /** 重复块 merge:点级 title 匹配则 evidences 并入,否则作为新点追加进目标需求 */
  private async mergeIntoRequirement(tx: ShipmateTx, targetRequirementId: string, block: DraftRequirement, actor: Actor): Promise<void> {
    const existing = await tx.select().from(requirementPoints).where(eq(requirementPoints.requirementId, targetRequirementId));
    for (const p of block.points) {
      const match = existing.find((e) => e.title === p.title);
      if (match) {
        const after = (
          await tx
            .update(requirementPoints)
            .set({
              evidences: [...match.evidences, ...p.evidences] as never,
              sourceMaterialIds: [...new Set([...match.sourceMaterialIds, ...p.evidences.map((e) => e.material_id)])] as never,
              updatedAt: Date.now(),
            })
            .where(eq(requirementPoints.id, match.id))
            .returning()
        )[0]!;
        await writeChangeLog(tx, {
          entityType: 'requirement_point',
          entityId: match.id,
          changeType: 'update',
          before: match,
          after,
          reason: `重复块「${block.title}」素材并入`,
          actor,
        });
      } else {
        await this.insertDraftPoint(tx, targetRequirementId, p, 'analysis', actor);
      }
    }
  }
```

同时在文件顶部补 import(合并进已有 drizzle-orm / schema 导入行):

```ts
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  analysisRuns,
  materials,
  projects,
  requirementPoints,
  requirements,
  tasks,
} from '../db/schema.js';
import type { ShipmateDb, ShipmateTx } from '../db/database.js';
import type { DraftPoint, DraftRequirement } from '../llm/schema.js';
```

并在类外追加类型导出:

```ts
export type ConflictResolution =
  'merge' | 'create_anyway' | 'skip' | 'use_new' | 'use_old' | 'keep_both';

export type ConflictDecision = {
  requirementTitle: string;
  resolution: ConflictResolution;
};
```

- [ ] **Step 4: 跑测试确认通过(全文件回归)**

Run: `pnpm -C packages/core test src/services/analysis.service.test.ts && pnpm -C packages/core typecheck`
Expected: 全部 PASS(Task 13 的 8 个 + 本任务 10 个)。

- [ ] **Step 5: 追加导出并 Commit**

`packages/core/src/index.ts` 中 AnalysisService 的导出行改为:

```ts
export {
  AnalysisService,
  createAnalysisService,
  type LlmInvoker,
  type AnalysisRunSummary,
  type ConflictDecision,
  type ConflictResolution,
} from './services/analysis.service.js';
```

```bash
git add packages/core/src/services/analysis.service.ts packages/core/src/services/analysis.service.test.ts packages/core/src/index.ts
git commit -m "feat(core): applyAnalysisRun 草稿应用——重复并入/相悖裁决/补充追加"
```

---

### Task 15: createCore 门面、README 与全量回归

**Files:**

- Modify: `packages/core/src/index.ts`(createCore + 全量导出)
- Create: `packages/core/README.md`
- Modify: `docs/design.md`(兜底核对 §3.2 `draft_result` 行、§3.7 `delete` 枚举、§8 apply 入参 title 定位注记——若前面任务尚未同步)

**Interfaces:**

- Consumes: 前面全部任务。
- Produces:
  - `function createCore(db: ShipmateDb): { groups: GroupService; projects: ProjectService; requirements: RequirementService; points: RequirementPointService; tasks: TaskService; audit: AuditService; settings: SettingsService; analysis: AnalysisService }`
  - `type ShipmateCore = ReturnType<typeof createCore>`
  - web/mcp 后续统一 `import { createCore } from '@shipmate/core'`。

- [ ] **Step 1: 写门面**

`packages/core/src/index.ts` 最终形态:

```ts
import type { ShipmateDb } from './db/database.js';
import { GroupService } from './services/group.service.js';
import { ProjectService } from './services/project.service.js';
import { RequirementService } from './services/requirement.service.js';
import { RequirementPointService } from './services/requirement-point.service.js';
import { TaskService } from './services/task.service.js';
import { AuditService } from './services/audit.service.js';
import { SettingsService } from './services/settings.service.js';
import { createAnalysisService } from './services/analysis.service.js';

export const CORE_VERSION = '0.1.0' as const;

// 错误与基础类型
export { DomainError, type DomainErrorCode } from './errors.js';
export type { Actor } from './types.js';
export { newId } from './db/id.js';
export {
  createDatabase,
  withDb,
  loadDotEnv,
  schema,
  type ShipmateDb,
  type ShipmateTx,
} from './db/database.js';
export * from './db/schema.js';

// 服务
export {
  GroupService,
  type CreateGroupInput,
  type GroupSummary,
  type GroupWithCount,
} from './services/group.service.js';
export {
  ProjectService,
  type CreateProjectInput,
  type ProjectSummary,
} from './services/project.service.js';
export {
  RequirementService,
  computeOverdue,
  type CreateRequirementInput,
  type RequirementWithOverdue,
} from './services/requirement.service.js';
export {
  RequirementPointService,
  type PointAction,
  type UpdatePointResult,
  type RequirementPointDetail,
} from './services/requirement-point.service.js';
export { TaskService, type TaskAction, type CreateTaskInput } from './services/task.service.js';
export { AuditService, type AuditReport, type ActorKind } from './services/audit.service.js';
export { SettingsService } from './services/settings.service.js';
export {
  AnalysisService,
  createAnalysisService,
  type LlmInvoker,
  type AnalysisRunSummary,
  type ConflictDecision,
  type ConflictResolution,
} from './services/analysis.service.js';
export { analysisResultSchema, type AnalysisResult } from './llm/schema.js';
export { chatJson, type LlmConfig } from './llm/client.js';
export { buildSystemPrompt, buildUserPrompt } from './llm/prompt.js';
export { writeChangeLog, type ChangeLogInput } from './services/change-log.js';

/** 统一门面:web 与 mcp 各自 new 一个,共享同一 db 连接 */
export function createCore(db: ShipmateDb) {
  return {
    groups: new GroupService(db),
    projects: new ProjectService(db),
    requirements: new RequirementService(db),
    points: new RequirementPointService(db),
    tasks: new TaskService(db),
    audit: new AuditService(db),
    settings: new SettingsService(db),
    analysis: createAnalysisService(db),
  };
}

export type ShipmateCore = ReturnType<typeof createCore>;
```

- [ ] **Step 2: 写 core README**

`packages/core/README.md`:

````markdown
# @shipmate/core

ShipMate 领域核心:需求全生命周期模型、状态机、实质修改联动、变更审计、AI 素材分析编排。

不依赖任何框架;数据库为 PostgreSQL,经 drizzle(node-postgres)注入。唯一规格:`docs/design.md`。

## 用法

```ts
import { createCore, createDatabase, loadDotEnv } from '@shipmate/core';

loadDotEnv(); // 读取仓库根 .env(首次运行种子化用)
const db = await createDatabase(process.env.SHIPMATE_DATABASE_URL!); // 自动执行 migrations(幂等)
const core = createCore(db);

const project = await core.projects.createProject({ name: '示例项目' }, 'human');
const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
await core.analysis.addMaterial(
  { runId: run.id, type: 'paste_text', rawContent: '素材...' },
  'human',
);
await core.analysis.startAnalysis(run.id, 'human');
await core.analysis.applyAnalysisRun(run.id, undefined, 'human'); // 默认全选,冲突按默认处置
```
````

## 约定

- 所有写操作带 `actor`(`'human' | 'ai:analysis' | \`mcp:<agent>\``),写操作全部落 change_logs
- 实质修改(需求点 title/description)在同一事务内:version+1 → ChangeLog → 任务联动 needs_reassessment → linkage_impact
- AI 产出永远 draft;confirm 是显式动作
- 全异步 API;连接信息只走 `.env`(gitignore),绝不写进任何被跟踪文件

## 开发

```bash
pnpm -C packages/core test          # 全量测试(远程测试库 + 事务回滚隔离)
pnpm -C packages/core typecheck
pnpm -C packages/core db:generate   # schema 变更后重新生成 migrations
```

````

- [ ] **Step 3: 全量回归**

Run: `pnpm -C packages/core test`
Expected: 全部测试文件 PASS(约 55+ 用例,首条查询可能因 migrate 稍慢,之后为网络往返速度)。

Run: `pnpm -C packages/core typecheck && pnpm lint && pnpm format:check`
Expected: 全部无错误(format 有告警就 `pnpm format` 后重查)。

- [ ] **Step 4: 核对 spec 补丁已回写 docs/design.md**

逐项确认(前面任务分散做的,此处兜底):
- §3.2 analysis_runs 表含 `draft_result`(jsonb,可空)行 —— Task 3
- §3.7 change_type 枚举含 `delete` —— Task 3
- §8 `apply_analysis_run` 行补注入:"草稿块以 title 定位(草稿未落库无 id);selectedRequirementIds 语义即草稿需求 title 数组" —— 本任务补

若任一缺失,现在补进 `docs/design.md`。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/README.md docs/design.md
git commit -m "feat(core): createCore 统一门面、README 与 spec 注记回写"
````

---

## 计划自审记录(已执行)

- **Spec 覆盖**:§2 工程约定(Task 1)、§3 全部表(Task 3)、§4 三个状态机 + 超期(Task 7/8/9)、§5 actor/实质修改/联动/草稿规则(Task 4/9/13/14)、§6 服务接口(Task 5-14 一一对应)、§7 错误码(Task 2 全集)、§9 分析流程 + 冲突三分类(Task 12/13/14)、§10 配置(Task 11,`SHIPMATE_DATABASE_URL` 替代 `SHIPMATE_DB_PATH`)、§11 core 测试策略(Task 3 事务回滚工厂 + 全任务 TDD)。§8(Plan 2)、§14(Plan 3)不在本计划。
- **D7 变更落实**:drizzle pg-core / bigint 时间戳 / jsonb / node-postgres 全异步 / 同库事务回滚测试(用户无 CREATEDB 权限,已用 DBX 实测确认)/ 凭据仅 `.env`(gitignore 已验证生效)。
- **占位扫描**:全任务无 TBD/TODO;Task 3 `loadDotEnv` 为最终形态(readFileSync 顶部导入,ESM 兼容)。
- **类型一致性**:`writeChangeLog(tx, input)` 全部调用点签名一致且 await;`ShipmateTx` 贯穿事务(嵌套自动 SAVEPOINT);`DraftPoint/DraftRequirement` Task 12 定义、Task 14 消费;`computeOverdue` Task 7 定义、Task 6 过渡函数随之删除;`withDb` Task 3 定义、Task 4-14 测试消费;`getLlmConfig` 为 async(Task 11 定义,Task 13 工厂 await)。
