# @shipmate/web

ShipMate 管理界面:Next.js 15(App Router)+ React 19 + Tailwind v4 双主题 + next-intl 中英双语。
把 `shipmate.pen` 20 帧原型与 `docs/design.md` §14 交互动效规格落成可用 UI。

## 起动

```bash
# 依赖安装(仓库根执行一次)
pnpm install

# 开发服务器(端口 47610)
pnpm -C packages/web dev

# 生产构建 / 起动
pnpm -C packages/web build
pnpm -C packages/web start
```

起动前需在**仓库根**放置 `.env`(参考 `.env.example`),必须包含:

| 环境变量                | 说明                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `SHIPMATE_DATABASE_URL` | PostgreSQL 连接串;web 首次请求时执行 core 的 drizzle 迁移并播种 env 默认 LLM 配置 |

LLM 配置(`SHIPMATE_LLM_*`)仅作首次启动默认值,之后以设置页存库数据为准。

## MCP 端点

`/api/mcp` 挂载 `@shipmate/mcp` 的 streamable HTTP handler(spec §10):

- `POST /api/mcp` — MCP JSON-RPC(initialize 建会话,后续帧带 `mcp-session-id`)
- `GET /api/mcp` — 会话流(需已有会话)
- `DELETE /api/mcp` — 关闭会话

stdio 接入配置见应用内「设置 → MCP 接入」页(P7)。

## 结构

- `src/actions/` — server actions 数据层(全部经 `@shipmate/core` 服务)
- `src/lib/core.ts` — db + core 全局单例(读根 `.env`)
- `src/components/` — 布局壳(侧栏三态/顶栏头像下拉)与各页组件
- `messages/zh-CN.json` / `messages/en.json` — next-intl 文案;`pnpm -C packages/web test` 跑键对称性检查(`scripts/check-i18n.mjs`)

设计 tokens 与动效规格见 `docs/design.md` §14 与 `docs/superpowers/plans/2026-09-11-web-package.md`。
