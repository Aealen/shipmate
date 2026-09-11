import { describe, expect, it } from 'vitest';
import { CORE_VERSION, createCore } from './index.js';
import { withDb } from './db/database.js';
import { GroupService } from './services/group.service.js';
import { ProjectService } from './services/project.service.js';
import { RequirementService } from './services/requirement.service.js';
import { RequirementPointService } from './services/requirement-point.service.js';
import { TaskService } from './services/task.service.js';
import { AuditService } from './services/audit.service.js';
import { SettingsService } from './services/settings.service.js';
import { AnalysisService } from './services/analysis.service.js';

describe('core 包骨架', () => {
  it('导出版本号', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });

  it('createCore 装配全部 8 个服务', async () => {
    await withDb(async (db) => {
      const core = createCore(db);
      expect(core.groups).toBeInstanceOf(GroupService);
      expect(core.projects).toBeInstanceOf(ProjectService);
      expect(core.requirements).toBeInstanceOf(RequirementService);
      expect(core.points).toBeInstanceOf(RequirementPointService);
      expect(core.tasks).toBeInstanceOf(TaskService);
      expect(core.audit).toBeInstanceOf(AuditService);
      expect(core.settings).toBeInstanceOf(SettingsService);
      expect(core.analysis).toBeInstanceOf(AnalysisService);
    });
  });
});
