import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { withDb, type ShipmateDb } from '../db/database.js';
import { changeLogs, modules, projects, requirementPoints, requirements } from '../db/schema.js';
import { newId } from '../db/id.js';
import { DomainError } from '../errors.js';
import { createCore } from '../index.js';
import { ModuleService } from './module.service.js';

const now = Date.now();

/** 测试辅助:建项目,返回 projectId */
async function seedProject(db: ShipmateDb, name = 'P'): Promise<string> {
  const p = (
    await db
      .insert(projects)
      .values({ id: newId(), name, status: 'active', createdAt: now, updatedAt: now })
      .returning()
  )[0]!;
  return p.id;
}

/** 测试辅助:建需求(可选挂载模块),返回 requirementId */
async function seedRequirement(
  db: ShipmateDb,
  projectId: string,
  moduleId: string | null = null,
  title = 'R',
): Promise<string> {
  const r = (
    await db
      .insert(requirements)
      .values({
        id: newId(),
        projectId,
        moduleId,
        title,
        status: 'draft',
        priority: 'P2',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;
  return r.id;
}

/** 测试辅助:建需求点 */
async function seedPoint(
  db: ShipmateDb,
  requirementId: string,
  status: 'draft' | 'confirmed' | 'developing' | 'done',
): Promise<void> {
  await db.insert(requirementPoints).values({
    id: newId(),
    requirementId,
    title: '点',
    status,
    version: 1,
    sourceMaterialIds: [],
    evidences: [],
    origin: 'manual',
    createdAt: now,
    updatedAt: now,
  });
}

describe('ModuleService', () => {
  it('createModule:落库默认 sort_order=0,change_logs 有 module create 记录', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      const projectId = await seedProject(db);
      const m = await svc.createModule(
        { projectId, name: '文档解析', description: 'PDF/OCR' },
        'human',
      );
      expect(m).toMatchObject({
        projectId,
        name: '文档解析',
        description: 'PDF/OCR',
        sortOrder: 0,
      });
      // 按 entityId 收窄:共享真实库中存在其他 module 日志
      const logs = await db
        .select()
        .from(changeLogs)
        .where(and(eq(changeLogs.entityType, 'module'), eq(changeLogs.entityId, m.id)));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ changeType: 'create', actor: 'human' });
      expect(logs[0]?.afterSnapshot).toMatchObject({ name: '文档解析' });
    });
  });

  it('createModule:同项目重名(trim 后)抛 MODULE_NAME_TAKEN;不同项目同名允许', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      const p1 = await seedProject(db, 'P1');
      const p2 = await seedProject(db, 'P2');
      await svc.createModule({ projectId: p1, name: '导入' }, 'human');
      try {
        await svc.createModule({ projectId: p1, name: ' 导入 ' }, 'human');
        expect.unreachable('应当抛 MODULE_NAME_TAKEN');
      } catch (e) {
        expect((e as DomainError).code).toBe('MODULE_NAME_TAKEN');
      }
      const m2 = await svc.createModule({ projectId: p2, name: '导入' }, 'human');
      expect(m2.projectId).toBe(p2);
    });
  });

  it('updateModule:改名与排序生效并写 update 变更', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      const projectId = await seedProject(db);
      const m = await svc.createModule({ projectId, name: '旧名' }, 'human');
      const after = await svc.updateModule(m.id, { name: '新名', sortOrder: 3 }, 'human');
      expect(after).toMatchObject({ name: '新名', sortOrder: 3 });
      const logs = await db
        .select()
        .from(changeLogs)
        .where(
          and(
            eq(changeLogs.entityType, 'module'),
            eq(changeLogs.entityId, m.id),
            eq(changeLogs.changeType, 'update'),
          ),
        );
      expect(logs).toHaveLength(1);
      expect(logs[0]?.beforeSnapshot).toMatchObject({ name: '旧名' });
      expect(logs[0]?.afterSnapshot).toMatchObject({ name: '新名', sortOrder: 3 });
    });
  });

  it('deleteModule:其下需求 moduleId 置 null 且需求仍在;模块 delete 快照与逐需求 update 记录齐备', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      const projectId = await seedProject(db);
      const m = await svc.createModule({ projectId, name: '待删' }, 'human');
      const r1 = await seedRequirement(db, projectId, m.id, '挂载一');
      const r2 = await seedRequirement(db, projectId, m.id, '挂载二');
      const r3 = await seedRequirement(db, projectId, null, '未挂载');

      await svc.deleteModule(m.id, 'human');

      const left = await db
        .select()
        .from(requirements)
        .where(eq(requirements.projectId, projectId));
      expect(left).toHaveLength(3);
      expect(left.find((r) => r.id === r1)?.moduleId).toBeNull();
      expect(left.find((r) => r.id === r2)?.moduleId).toBeNull();
      expect(left.find((r) => r.id === r3)?.moduleId).toBeNull();
      expect(await db.select().from(modules).where(eq(modules.id, m.id))).toHaveLength(0);

      const delLogs = await db
        .select()
        .from(changeLogs)
        .where(
          and(
            eq(changeLogs.entityType, 'module'),
            eq(changeLogs.entityId, m.id),
            eq(changeLogs.changeType, 'delete'),
          ),
        );
      expect(delLogs).toHaveLength(1);
      expect(delLogs[0]?.beforeSnapshot).toMatchObject({ name: '待删' });

      // 逐需求写 update 变更,reason 固定(spec D8 转未归类)
      for (const rid of [r1, r2]) {
        const logs = await db
          .select()
          .from(changeLogs)
          .where(
            and(
              eq(changeLogs.entityType, 'requirement'),
              eq(changeLogs.entityId, rid),
              eq(changeLogs.changeType, 'update'),
            ),
          );
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ reason: '模块删除转未归类', actor: 'human' });
        expect(logs[0]?.beforeSnapshot).toMatchObject({ moduleId: m.id });
      }
    });
  });

  it('deleteModule:模块不存在抛 NOT_FOUND', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      try {
        await svc.deleteModule('missing', 'human');
        expect.unreachable('应当抛 NOT_FOUND');
      } catch (e) {
        expect((e as DomainError).code).toBe('NOT_FOUND');
      }
    });
  });

  it('listModules:统计 requirementCount/pointsDone/pointsTotal,组序按 sortOrder→name,跨项目隔离', async () => {
    await withDb(async (db) => {
      const svc = new ModuleService(db);
      const projectId = await seedProject(db);
      const mA = await svc.createModule({ projectId, name: 'A' }, 'human');
      const mB = await svc.createModule({ projectId, name: 'B' }, 'human');
      await svc.updateModule(mA.id, { sortOrder: 5 }, 'human');

      // 模块 A:2 需求共 3 点,其中 1 点 done;模块 B:空
      const r1 = await seedRequirement(db, projectId, mA.id);
      const r2 = await seedRequirement(db, projectId, mA.id);
      await seedPoint(db, r1, 'done');
      await seedPoint(db, r1, 'draft');
      await seedPoint(db, r2, 'confirmed');

      // 干扰项:其他项目同名模块不计入本项目统计
      const other = await seedProject(db, 'other');
      await svc.createModule({ projectId: other, name: 'A' }, 'human');

      const list = await svc.listModules(projectId);
      expect(list).toHaveLength(2);
      // 组序:sortOrder 0 的 B 在前,5 的 A 在后
      expect(list.map((m) => m.name)).toEqual(['B', 'A']);
      expect(list.find((m) => m.id === mA.id)).toMatchObject({
        requirementCount: 2,
        pointsDone: 1,
        pointsTotal: 3,
      });
      expect(list.find((m) => m.id === mB.id)).toMatchObject({
        requirementCount: 0,
        pointsDone: 0,
        pointsTotal: 0,
      });
    });
  });

  it('createCore 门面挂载 modules 服务', async () => {
    await withDb(async (db) => {
      expect(createCore(db).modules).toBeInstanceOf(ModuleService);
    });
  });
});
