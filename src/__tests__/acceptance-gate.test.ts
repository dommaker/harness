/**
 * SpecAcceptanceGate 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { SpecAcceptanceGate, createSpecAcceptanceGate } from '../gates/acceptance';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('SpecAcceptanceGate', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-acceptance');
  const tasksFile = path.join(tempDir, 'tasks.yml');
  const customTasksFile = path.join(tempDir, 'custom-tasks.yml');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    // 每个测试前清空临时目录
    try {
      fs.rmSync(tasksFile, { force: true });
      fs.rmSync(customTasksFile, { force: true });
    } catch {
      // ignore
    }
  });

  describe('check', () => {
    it('tasks.yml 不存在应该返回 passed（跳过检查）', async () => {
      const gate = new SpecAcceptanceGate();
      const result = await gate.check({
        projectPath: tempDir,
        tasksPath: path.join(tempDir, 'nonexistent.yml'),
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('No tasks');
    });

    it('空任务列表应该通过', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({ tasks: [] }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('所有验收标准已检查应该通过', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            name: 'Test Task',
            completed: true,
            acceptance_criteria: [
              { id: 'AC-001', description: 'Test', type: 'manual', required: true, checked: true },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('未检查的验收标准应该失败', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            name: 'Test Task',
            status: 'done',
            acceptance_criteria: [
              { id: 'AC-001', description: 'Required 1', type: 'manual', required: true, checked: false },
              { id: 'AC-002', description: 'Required 2', type: 'manual', required: true, checked: false },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('fail');
    });

    it('应该支持新格式 acceptance', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            name: 'Test Task',
            completed: true,
            acceptance: [
              { description: 'Feature works', checked: true },
              { description: 'Another feature', checked: true },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it.skip('新格式 acceptance 未检查应该失败（关联 E2E 测试）', async () => {
      // E2E 测试需要真实环境，跳过
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            name: 'Test Task',
            completed: true,
            acceptance: [
              { description: 'Feature works', e2e_test: 'tests/e2e/test.spec.ts', checked: false },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile, e2eTestCommand: 'echo passed' });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.details?.taskId).toBe('TASK-001');
    });

    it('任务没有验收标准应该通过', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            name: 'No Criteria',
            completed: true,
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('检查所有任务模式', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          { id: 'TASK-001', acceptance_criteria: [{ id: 'AC-001', description: 'T1', type: 'manual', required: true, checked: true }] },
          { id: 'TASK-002', acceptance_criteria: [{ id: 'AC-002', description: 'T2', type: 'manual', required: true, checked: true }] },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile, checkAllTasks: true });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('All tasks');
    });

    it('部分任务失败', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          { id: 'TASK-001', acceptance_criteria: [{ id: 'AC-001', description: 'T1', type: 'manual', required: true, checked: true }] },
          { id: 'TASK-002', acceptance_criteria: [{ id: 'AC-002', description: 'T2', type: 'manual', required: true, checked: false }] },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile, checkAllTasks: true });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('fail');
    });
  });

  describe('指定任务检查', () => {
    it('应该只检查指定任务', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            acceptance_criteria: [
              { id: 'AC-001', description: 'Test', type: 'manual', required: true, checked: false },
            ],
          },
          {
            id: 'TASK-002',
            acceptance_criteria: [
              { id: 'AC-002', description: 'Test', type: 'manual', required: true, checked: true },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
        taskId: 'TASK-002',
      });

      expect(result.passed).toBe(true);
      expect(result.details?.taskId).toBe('TASK-002');
    });

    it('任务不存在应该失败', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [{ id: 'TASK-001', completed: true, acceptance_criteria: [] }],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
        taskId: 'TASK-999',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('已完成任务检查', () => {
    it('只检查已完成任务', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          { id: 'TASK-001', status: 'todo', acceptance_criteria: [{ id: 'AC-001', description: 'T1', type: 'manual', required: true, checked: false }] },
          { id: 'TASK-002', status: 'done', acceptance_criteria: [{ id: 'AC-002', description: 'T2', type: 'manual', required: true, checked: true }] },
          { id: 'TASK-003', completed: true, acceptance_criteria: [{ id: 'AC-003', description: 'T3', type: 'manual', required: true, checked: true }] },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('已完成任务未检查验收标准应该失败', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          { id: 'TASK-001', status: 'done', acceptance_criteria: [{ id: 'AC-001', description: 'T1', type: 'manual', required: true, checked: false }] },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(false);
    });

    it('没有已完成任务应该通过', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          { id: 'TASK-001', status: 'in-progress', acceptance_criteria: [{ id: 'AC-001', description: 'T1', type: 'manual', required: true, checked: false }] },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('No completed');
    });
  });

  describe('配置', () => {
    it('应该支持自定义 tasksPath', async () => {
      fs.writeFileSync(customTasksFile, yaml.dump({ tasks: [] }));

      const gate = new SpecAcceptanceGate({ tasksPath: customTasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('应该支持自定义 E2E 测试命令', () => {
      const gate = new SpecAcceptanceGate({ e2eTestCommand: 'npm run test:e2e' });
      expect(gate).toBeDefined();
    });

    it('应该支持自定义超时时间', () => {
      const gate = new SpecAcceptanceGate({ e2eTestTimeout: 60000 });
      expect(gate).toBeDefined();
    });

    it('应该支持自定义验收条件检查', () => {
      const customCheck = async () => true;
      const gate = new SpecAcceptanceGate({
        customAcceptanceCriteria: { 'custom-type': customCheck },
      });
      expect(gate).toBeDefined();
    });
  });

  describe('非必须验收标准', () => {
    it('非必须标准未检查不应该失败', async () => {
      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            completed: true,
            acceptance_criteria: [
              { id: 'AC-001', description: 'Required', type: 'manual', required: true, checked: true },
              { id: 'AC-002', description: 'Optional', type: 'manual', required: false, checked: false },
            ],
          },
        ],
      }));

      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('createSpecAcceptanceGate', () => {
    it('便捷函数应该创建 gate', () => {
      const gate = createSpecAcceptanceGate({ tasksPath: tasksFile });
      expect(gate).toBeDefined();
      expect(gate).toBeInstanceOf(SpecAcceptanceGate);
    });
  });
});
