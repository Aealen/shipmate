import { describe, expect, it } from 'vitest';
import { analysisRuns, createCore, newId, withDb, type ShipmateDb } from '@shipmate/core';
import { callTool, setupServer } from '../test-helpers.js';

/** 仿 core T14 seedDraft:直接落一条带草稿的 done 批次,绕开 LLM 真调用 */
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
        draftResult: draft,
        createdAt: now,
        completedAt: now,
      })
      .returning()
  )[0]!.id;
}

const goodDraft = {
  requirements: [
    {
      title: '全新需求A',
      summary: '摘要A',
      points: [
        {
          title: '点A1',
          description: '',
          confidence: 0.8,
          evidences: [{ material_id: 'm1', quote: '原文' }],
        },
      ],
    },
  ],
  supplements: [],
};

const conflictDraft = {
  requirements: [
    {
      title: '相悖块',
      summary: '',
      conflict: { type: 'contradiction', target_requirement_title: '已有需求X', reason: '' },
      points: [],
    },
  ],
  supplements: [],
};

describe('素材与分析工具', () => {
  it('tools/list 注册了全部素材与分析工具', async () => {
    await withDb(async (db) => {
      const { client } = await setupServer(db);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      for (const name of [
        'create_analysis_run',
        'add_material',
        'list_materials',
        'get_material',
        'start_analysis',
        'apply_analysis_run',
        'list_analysis_runs',
        'get_analysis_run',
      ]) {
        expect(names).toContain(name);
      }
    });
  });

  it('create_analysis_run 落库 pending,标题缺省自动命名', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'create_analysis_run', {
        projectId: project.id,
        title: '周三素材批',
      });
      expect(isError).toBe(false);
      const run = JSON.parse(text);
      expect(run).toMatchObject({ projectId: project.id, title: '周三素材批', status: 'pending' });

      const untitled = await callTool(client, 'create_analysis_run', { projectId: project.id });
      expect(JSON.parse(untitled.text).title).toContain('素材分析');

      // 审计 actor 为注入值
      const logs = await core.audit.getChangeLog({
        entityType: 'analysis_run',
        entityId: run.id,
      });
      expect(logs[0]).toMatchObject({ actor: 'mcp:test', changeType: 'create' });
    });
  });

  it('add_material 落库,list_materials 以 runId 返回全部素材', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
      const { client } = await setupServer(db);

      const added = await callTool(client, 'add_material', {
        runId: run.id,
        type: 'paste_text',
        rawContent: '客户原话:要能导出报表',
        title: '客户访谈',
      });
      expect(added.isError).toBe(false);
      const material = JSON.parse(added.text);
      expect(material).toMatchObject({
        analysisRunId: run.id,
        type: 'paste_text',
        title: '客户访谈',
      });

      const listed = JSON.parse((await callTool(client, 'list_materials', { runId: run.id })).text);
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(material.id);

      // 空内容被拒
      const empty = await callTool(client, 'add_material', {
        runId: run.id,
        type: 'doc',
        rawContent: '   ',
      });
      expect(empty.isError).toBe(true);
      expect(empty.text).toContain('VALIDATION_ERROR');
    });
  });

  it('get_material 按 runId+id 取素材,不存在返回 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
      const material = await core.analysis.addMaterial(
        { runId: run.id, type: 'doc', rawContent: '正文' },
        'human',
      );
      const { client } = await setupServer(db);

      const got = await callTool(client, 'get_material', { runId: run.id, id: material.id });
      expect(got.isError).toBe(false);
      expect(JSON.parse(got.text)).toMatchObject({ id: material.id });

      const ghost = await callTool(client, 'get_material', { runId: run.id, id: 'ghost' });
      expect(ghost.isError).toBe(true);
      expect(ghost.text).toContain('NOT_FOUND');
    });
  });

  it('start_analysis 空素材返回 isError 含 VALIDATION_ERROR(不真调 LLM)', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'start_analysis', { runId: run.id });
      expect(isError).toBe(true);
      expect(text).toContain('VALIDATION_ERROR');
    });
  });

  it('apply_analysis_run 普通块落库为 draft 需求,点带 evidences 溯源', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const runId = await seedDraft(db, project.id, goodDraft);
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'apply_analysis_run', { runId });
      expect(isError).toBe(false);
      const created = JSON.parse(text);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ title: '全新需求A', status: 'draft', priority: 'P2' });
      const points = await core.points.listRequirementPoints({
        requirementId: created[0].id,
      });
      expect(points[0]).toMatchObject({ title: '点A1', origin: 'analysis' });
    });
  });

  it('apply_analysis_run 相悖块未裁决报 VALIDATION_ERROR,use_old 丢弃,use_new 落库', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      await core.requirements.createRequirement(
        { projectId: project.id, title: '已有需求X' },
        'human',
      );
      const { client } = await setupServer(db);

      // 未裁决
      const runId1 = await seedDraft(db, project.id, conflictDraft);
      const unjudged = await callTool(client, 'apply_analysis_run', { runId: runId1 });
      expect(unjudged.isError).toBe(true);
      expect(unjudged.text).toContain('VALIDATION_ERROR');

      // use_old:草稿丢弃
      const runId2 = await seedDraft(db, project.id, conflictDraft);
      const useOld = await callTool(client, 'apply_analysis_run', {
        runId: runId2,
        decisions: [{ requirementTitle: '相悖块', resolution: 'use_old' }],
      });
      expect(useOld.isError).toBe(false);
      expect(JSON.parse(useOld.text)).toHaveLength(0);

      // use_new:落库并使旧任务待重估
      const runId3 = await seedDraft(db, project.id, conflictDraft);
      const useNew = await callTool(client, 'apply_analysis_run', {
        runId: runId3,
        decisions: [{ requirementTitle: '相悖块', resolution: 'use_new' }],
      });
      expect(useNew.isError).toBe(false);
      expect(JSON.parse(useNew.text)).toHaveLength(1);
      const reqs = await core.requirements.listRequirements(project.id);
      expect(reqs.map((r) => r.title)).toContain('相悖块');
    });
  });

  it('list_analysis_runs 带素材数与草稿统计,支持 status 过滤', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
      await core.analysis.addMaterial({ runId: run.id, type: 'doc', rawContent: '素材1' }, 'human');
      await seedDraft(db, project.id, goodDraft);
      const { client } = await setupServer(db);

      const all = JSON.parse(
        (await callTool(client, 'list_analysis_runs', { projectId: project.id })).text,
      );
      expect(all).toHaveLength(2);
      const seeded = all.find((r: { title: string }) => r.title === '批次');
      expect(seeded).toMatchObject({ status: 'done', draftRequirementCount: 1 });
      const pending = all.find((r: { title: string }) => r.title !== '批次');
      expect(pending).toMatchObject({ status: 'pending', materialCount: 1 });

      const onlyDone = JSON.parse(
        (
          await callTool(client, 'list_analysis_runs', {
            projectId: project.id,
            status: 'done',
          })
        ).text,
      );
      expect(onlyDone.map((r: { title: string }) => r.title)).toEqual(['批次']);
    });
  });

  it('get_analysis_run 返回批次 + 素材 + 草稿', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      const project = await core.projects.createProject({ name: '项目' }, 'human');
      const run = await core.analysis.createAnalysisRun({ projectId: project.id }, 'human');
      await core.analysis.addMaterial(
        { runId: run.id, type: 'doc', rawContent: '素材正文' },
        'human',
      );
      const { client } = await setupServer(db);

      const { isError, text } = await callTool(client, 'get_analysis_run', { id: run.id });
      expect(isError).toBe(false);
      const detail = JSON.parse(text);
      expect(detail.run).toMatchObject({ id: run.id, status: 'pending' });
      expect(detail.materials).toHaveLength(1);
    });
  });
});
