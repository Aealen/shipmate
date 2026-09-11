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
