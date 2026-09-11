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
