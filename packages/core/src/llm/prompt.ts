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

/**
 * 构建主分析 user prompt。
 * moduleNames:项目已有模块名列表(spec §9 规则 10);为空时不注入模块归类段。
 */
export function buildUserPrompt(
  materials: MaterialRow[],
  existing: ExistingRequirementDigest[],
  moduleNames: string[] = [],
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
  const moduleSection = moduleNames.length
    ? `## 模块归类\n项目已有模块:[${moduleNames.join('、')}]。为每个需求块给出 module 归类建议:优先使用已有模块名;确无合适模块时可建议新模块名;确实无法归类则留空字符串。同批素材可归属不同模块。`
    : '';
  return `## 已有需求(用于判断重复/相悖/补充)\n${existingSection}\n\n${moduleSection ? `${moduleSection}\n\n` : ''}## 待分析素材\n${materialSection}`;
}

/** spec §9 AI 修订:按用户批注重写草稿中的需求块或需求点,只输出修订后 JSON */
export function buildReviseSystemPrompt(scope: 'block' | 'point'): string {
  const target = scope === 'block' ? '需求块(含其下全部需求点)' : '需求点';
  const shape =
    scope === 'block'
      ? `{
  "title": "需求标题",
  "summary": "一句话摘要",
  "conflict": { "type": "duplicate 或 contradiction", "target_requirement_title": "已有需求标题", "reason": "判定原因" },
  "points": [
    { "title": "需求点标题", "description": "描述", "confidence": 0.0,
      "evidences": [ { "material_id": "素材ID", "quote": "原文引用段落" } ] }
  ]
}
(无冲突信息时省略 conflict 字段)`
      : `{
  "title": "需求点标题",
  "description": "描述",
  "confidence": 0.0,
  "evidences": [ { "material_id": "素材ID", "quote": "原文引用段落" } ]
}`;
  return `你是资深需求分析师。请按用户的批注修订当前${target},只输出修订后的 JSON,结构如下:
${shape}
规则:
1. 严格按批注修订,批注未涉及的部分保持原样
2. confidence 按修订后内容重新估计(0~1)
3. evidences(素材原文依据)原样保留,除非批注明确涉及依据的增删改;确需新增依据时引用已有素材原文,禁止编造
4. 修订结果不得与「项目已有需求」实质重复
5. 口吻、粒度与整批分析产出保持一致
6. 只输出 JSON,不输出任何其他文字`;
}

export function buildReviseUserPrompt(
  current: unknown,
  annotation: string,
  existing: ExistingRequirementDigest[],
): string {
  const existingSection = existing.length
    ? existing
        .map(
          (r) =>
            `- ${r.title}(${r.id}):${r.summary || '(无摘要)'} | 需求点:${r.points.map((p) => p.title).join('、') || '无'}`,
        )
        .join('\n')
    : '(暂无已有需求)';
  return `## 项目已有需求(修订结果不得与之实质重复)\n${existingSection}\n\n## 当前内容(JSON)\n${JSON.stringify(current, null, 2)}\n\n## 修订批注\n${annotation}`;
}
