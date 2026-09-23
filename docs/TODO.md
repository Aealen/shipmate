# ShipMate 待办 / 二期项

## 二期:模块支持多选(2026-09-23 调研定案,暂缓)

**决策**:改动面大,一期不做;真实使用已撞到限制(跨模块需求如「LTC 总部下发对接」同时涉及 CRM 与系统对接,单选丢失归属维度),二期实施。

**已定方案**(2026-09-23 调研,实施时直接照此):

- 数据:`requirements.module_id` → `module_ids` 有序 JSON 数组(jsonb),**首位为主模块**(面包屑/默认排序兜底);现值平移迁移
- core:assertModuleUsable 循环校验;listRequirements 模块筛选改 jsonb contains;模块删除从"置 null"改"从数组移除";模块统计规则=**参与即计入**(每涉及模块都计数)
- AI 链路:LLM schema `module: string` → `modules: string[]`(限制 1-3 个),apply 逐个同名匹配/新建;prompt 同步
- MCP:create_requirement / update_requirement 入参 `moduleId` → `moduleIds`
- web:模块选择器单选→多选(工作台归类行 + 需求编辑弹窗);看板/进度筛选改"命中任一即显示";P4 面包屑取主模块;P3 需求卡多模块 pill
- 原型:P3l 选择器多选化、P3 分组展示配套

**待拍板**:P3 需求列表按模块分组的形态——A. 保留分组,多模块需求在涉及的每组重复出现(带 pill 标注,Jira Component 心智);B. 分组弱化为顶部筛选 chips + 平铺(与看板/进度一致)。倾向 A。

**受影响的单选假设位置**(调研时定位,实施时排查):analysis-browse.tsx 的 reqsByModule 分组、board-view/progress-view 的模块筛选链(任务→需求点→需求.moduleId)、P4 面包屑(points/[pointId]/page.tsx)、modules-panel 统计、analysis.service 的 resolveModuleId、mcp requirements 工具入参。

## 一期内挂起

- **Deadline 功能收尾**(spec §9 规则 11,WIP 已提交 d634665):analysis.service.test.ts 补 deadline 用例后即完整
