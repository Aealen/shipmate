import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DomainError, type Actor, type ShipmateCore } from '@shipmate/core';
import { withCore } from '../util.js';

export function registerAnalysisTools(server: McpServer, core: ShipmateCore, actor: Actor): void {
  server.registerTool(
    'create_analysis_run',
    {
      title: '创建分析批次',
      description: '为项目创建素材分析批次(pending),标题缺省按时间自动命名',
      inputSchema: {
        projectId: z.string().describe('所属项目 id'),
        title: z.string().optional().describe('批次标题,缺省自动命名'),
      },
    },
    withCore(core, actor, (c, args) => c.analysis.createAnalysisRun(args, actor)),
  );

  server.registerTool(
    'add_material',
    {
      title: '添加素材',
      description: '向分析批次添加素材(同一批次可多次调用);内容不能为空',
      inputSchema: {
        runId: z.string().describe('分析批次 id'),
        type: z
          .enum(['paste_text', 'screenshot_text', 'doc'])
          .describe('素材类型:粘贴文本/截图提取文本/文档'),
        rawContent: z.string().describe('素材原文内容'),
        title: z.string().optional().describe('素材标题'),
      },
    },
    withCore(core, actor, (c, args) => c.analysis.addMaterial(args, actor)),
  );

  server.registerTool(
    'list_materials',
    {
      title: '列出素材',
      description: '列出分析批次内的全部素材',
      inputSchema: { runId: z.string().describe('分析批次 id') },
    },
    withCore(
      core,
      actor,
      async (c, { runId }) => (await c.analysis.getAnalysisRun(runId)).materials,
    ),
  );

  server.registerTool(
    'get_material',
    {
      title: '查询素材',
      description: '按 id 查询批次内的单个素材',
      inputSchema: {
        runId: z.string().describe('分析批次 id'),
        id: z.string().describe('素材 id'),
      },
    },
    withCore(core, actor, async (c, { runId, id }) => {
      const { materials } = await c.analysis.getAnalysisRun(runId);
      const material = materials.find((m) => m.id === id);
      if (!material) throw new DomainError('NOT_FOUND', `素材 ${id} 不存在`);
      return material;
    }),
  );

  server.registerTool(
    'update_material',
    {
      title: '更新素材',
      description: '按 id 更新素材的标题/原文;title 与 rawContent 至少提供一项,变更记审计',
      inputSchema: {
        id: z.string().describe('素材 id'),
        title: z.string().optional().describe('新标题;不传保持不变'),
        rawContent: z.string().optional().describe('新原文内容;不传保持不变'),
      },
    },
    withCore(core, actor, (c, { id, title, rawContent }) =>
      c.analysis.updateMaterial(id, { title, rawContent }, actor),
    ),
  );

  server.registerTool(
    'start_analysis',
    {
      title: '启动 AI 分析',
      description:
        '汇集批次内全部素材调 LLM 产出结构化草稿并暂存到批次(不落业务表);同步执行,耗时取决于模型',
      inputSchema: { runId: z.string().describe('分析批次 id') },
    },
    withCore(core, actor, (c, { runId }) => c.analysis.startAnalysis(runId, actor)),
  );

  server.registerTool(
    'apply_analysis_run',
    {
      title: '应用分析草稿',
      description:
        '把批次草稿事务落库为 draft 需求(默认全选);重复块默认并入已有需求,相悖块必须携带裁决(use_new/use_old/keep_both),补充仅追加新点;草稿块以 title 定位',
      inputSchema: {
        runId: z.string().describe('分析批次 id'),
        selectedRequirements: z
          .array(z.string())
          .optional()
          .describe('要应用的草稿需求 title 列表,缺省全选'),
        selectedSupplements: z
          .array(z.string())
          .optional()
          .describe('要应用的补充 target_requirement_title 列表,缺省全部'),
        decisions: z
          .array(
            z.object({
              requirementTitle: z.string().describe('草稿需求 title'),
              resolution: z
                .enum(['merge', 'create_anyway', 'skip', 'use_new', 'use_old', 'keep_both'])
                .describe(
                  '冲突处置:重复块 merge/create_anyway/skip;相悖块 use_new/use_old/keep_both',
                ),
            }),
          )
          .optional()
          .describe('冲突裁决决定'),
      },
    },
    withCore(core, actor, (c, { runId, selectedRequirements, selectedSupplements, decisions }) =>
      c.analysis.applyAnalysisRun(
        runId,
        { selectedRequirements, selectedSupplements, decisions },
        actor,
      ),
    ),
  );

  server.registerTool(
    'revise_draft',
    {
      title: 'AI 修订草稿',
      description: '按批注让 AI 重写草稿中的某个需求块或需求点(修订前快照自动入审计)',
      inputSchema: {
        runId: z.string().describe('分析批次 id'),
        blockIndex: z.number().int().min(0).describe('草稿需求块下标(从 0 起)'),
        pointIndex: z.number().int().min(0).optional().describe('需求点下标;缺省修订整块'),
        annotation: z.string().min(1).describe('修订批注,告诉 AI 怎么改'),
        keepEvidences: z.boolean().optional().describe('默认 true,保留原文依据'),
      },
    },
    withCore(
      core,
      actor,
      async (c, { runId, blockIndex, pointIndex, annotation, keepEvidences }) => {
        const { revised } = await c.analysis.reviseDraft(
          runId,
          { blockIndex, pointIndex },
          annotation,
          { keepEvidences },
          actor,
        );
        return revised;
      },
    ),
  );

  server.registerTool(
    'list_analysis_runs',
    {
      title: '列出分析批次',
      description: '列出项目的分析批次,每项含素材数(materialCount)与草稿产出统计;可按状态过滤',
      inputSchema: {
        projectId: z.string().describe('项目 id'),
        status: z.enum(['pending', 'done', 'failed']).optional().describe('按批次状态过滤'),
      },
    },
    withCore(core, actor, (c, { projectId, status }) =>
      c.analysis.listAnalysisRuns(projectId, status === undefined ? undefined : { status }),
    ),
  );

  server.registerTool(
    'get_analysis_run',
    {
      title: '查询分析批次',
      description: '查询单个分析批次:记录本体 + 全部素材 + 草稿产出(若有)',
      inputSchema: { id: z.string().describe('分析批次 id') },
    },
    withCore(core, actor, (c, { id }) => c.analysis.getAnalysisRun(id)),
  );
}
