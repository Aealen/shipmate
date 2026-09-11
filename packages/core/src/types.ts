/**
 * spec §5.1 actor 全记录:
 * - human:Web UI 操作(web 门面固定传)
 * - mcp:<agent名>:agent 经 MCP 操作
 * - ai:analysis:core 内部分析编排
 */
export type Actor = 'human' | 'ai:analysis' | `mcp:${string}`;
