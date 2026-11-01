/**
 * SpecAcceptanceGate 测试
 *
 * 旧格式 `acceptance_criteria`（含 required 可选语义）与死配置
 * `customAcceptanceCriteria` 已随 gates 层现代化删除：本文件只喂新契约
 * `acceptance`——checked:true → 满足；未勾选 → 不满足（有 e2e_test 则按测试结论）。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { SpecAcceptanceGate } from '../acceptance';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from '../../utils/yaml';

describe('SpecAcceptanceGate', () => {
  let tempDir: string;
  let tasksFile: string;
  let customTasksFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-acceptance-'));
    tasksFile = path.join(tempDir, 'tasks.yml');
    customTasksFile = path.join(tempDir, 'custom-tasks.yml');
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
            acceptance: [
              { description: 'Test', checked: true },
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
            acceptance: [
              { description: 'Required 1', checked: false },
              { description: 'Required 2', checked: false },
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
          { id: 'TASK-001', acceptance: [{ description: 'T1', checked: true }] },
          { id: 'TASK-002', acceptance: [{ description: 'T2', checked: true }] },
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
          { id: 'TASK-001', acceptance: [{ description: 'T1', checked: true }] },
          { id: 'TASK-002', acceptance: [{ description: 'T2', checked: false }] },
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
            acceptance: [
              { description: 'Test', checked: false },
            ],
          },
          {
            id: 'TASK-002',
            acceptance: [
              { description: 'Test', checked: true },
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
        tasks: [{ id: 'TASK-001', completed: true, acceptance: [] }],
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
          { id: 'TASK-001', status: 'todo', acceptance: [{ description: 'T1', checked: false }] },
          { id: 'TASK-002', status: 'done', acceptance: [{ description: 'T2', checked: true }] },
          { id: 'TASK-003', completed: true, acceptance: [{ description: 'T3', checked: true }] },
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
          { id: 'TASK-001', status: 'done', acceptance: [{ description: 'T1', checked: false }] },
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
          { id: 'TASK-001', status: 'in-progress', acceptance: [{ description: 'T1', checked: false }] },
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
  });

  describe('E2E argv 直通真实运行器（不经 shell 端到端）', () => {
    it('特殊字符的 e2e_test / test_name 各自作为单个参数到达运行器，且不被 shell 解释', async () => {
      const marker = path.join(tempDir, 'pwned');
      fs.rmSync(marker, { force: true });
      const specialFile = `tests/evil file$(touch ${marker});` + '`id`' + `&&echo "quoted".spec.ts`;
      const specialName = 'should run $(whoami) and `id`; "quoted" name';

      fs.writeFileSync(tasksFile, yaml.dump({
        tasks: [
          {
            id: 'TASK-001',
            acceptance: [
              {
                description: 'E2E 直通',
                checked: false,
                e2e_test: specialFile,
                test_name: specialName,
              },
            ],
          },
        ],
      }));

      // 可信命令串（node runner）原样打印收到的 argv；不可信数据若在命令串里会被 shell 解释
      const gate = new SpecAcceptanceGate({
        tasksPath: tasksFile,
        e2eTestCommand:
          `node -e "console.log(JSON.stringify(process.argv.slice(1)));console.log('1 passed')"`,
      });

      // taskId 路径直接返回 per-task 明细（聚合路径不带 e2eTestResults）
      const result = await gate.check({ projectPath: tempDir, taskId: 'TASK-001' });

      expect(result.passed).toBe(true);
      const output = result.details?.e2eTestResults?.[0]?.output ?? '';
      const argv = JSON.parse(output.trim().split('\n')[0] as string) as string[];
      expect(argv).toContain(specialFile);
      const gIndex = argv.indexOf('-g');
      expect(argv[gIndex + 1]).toBe(specialName);
      // shell 解释 $(touch ...) 的铁证：标记文件不存在
      expect(fs.existsSync(marker)).toBe(false);
    });
  });

  describe('createSpecAcceptanceGate（内联工厂已随 #199 入口清空删除，等价构造直走类）', () => {
    it('便捷函数应该创建 gate', () => {
      const gate = new SpecAcceptanceGate({ tasksPath: tasksFile });
      expect(gate).toBeDefined();
      expect(gate).toBeInstanceOf(SpecAcceptanceGate);
    });
  });
});
