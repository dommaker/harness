/**
 * SpecAcceptanceGate 测试
 *
 * 旧格式 `acceptance_criteria` 兼容分支已删（gates 层现代化）：本文件只喂
 * 新契约 `acceptance`。判定语义：checked:true → 满足；未勾选带 e2e_test →
 * 跑测试按结论判定；未勾选无 e2e_test → 不满足（判负）。
 *
 * e2e 执行形状（D1）：tasks.yml 的 e2e_test / test_name 是不可信数据，只作为
 * execFile 的 argv 数组元素到达运行器（不经 shell）；本文件 mock execFile 精确
 * 断言 file / argv / options。
 */

import { SpecAcceptanceGate } from '../acceptance';
import * as fs from 'fs/promises';
import { exec, execFile } from 'child_process';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execFile: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExec = exec as unknown as jest.Mock;
const mockExecFile = execFile as unknown as jest.Mock;

describe('SpecAcceptanceGate', () => {
  let gate: SpecAcceptanceGate;

  beforeEach(() => {
    jest.clearAllMocks();
    // 缺省桩：任何未显式打桩的 exec/execFile 调用立即失败，防测试挂起在永不回调的 mock 上
    const fail = (...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: unknown) => void;
      callback(new Error('exec/execFile 未被本用例打桩'));
    };
    mockExec.mockImplementation(fail);
    mockExecFile.mockImplementation(fail);
    gate = new SpecAcceptanceGate();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const defaultGate = new SpecAcceptanceGate();
      expect(defaultGate).toBeDefined();
    });

    it('should merge custom config', () => {
      const customGate = new SpecAcceptanceGate({
        tasksPath: './custom-tasks.yml',
        e2eTestTimeout: 60000,
      });
      expect(customGate).toBeDefined();
    });
  });

  describe('check()', () => {
    it('should pass when no tasks.yml found', async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('No tasks.yml found');
    });

    it('should pass when no tasks defined', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks: []
`);

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('no tasks defined');
    });

    it('should check specific task by taskId', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    description: Test task
    acceptance:
      - description: Test criteria
        checked: true
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(result.details?.taskId).toBe('TASK-001');
    });

    it('should fail when task not found', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    description: Test task
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-999',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Task not found');
    });

    it('YAML 解析失败 → 抛出（fail-fast，不拼错误报告）', async () => {
      mockFs.readFile.mockResolvedValueOnce('invalid: yaml: content: [');

      await expect(gate.check({
        projectPath: '/test/project',
      })).rejects.toThrow();
    });

    it('tasks.yml 缺 tasks 数组 → 抛出指名路径的格式错误', async () => {
      mockFs.readFile.mockResolvedValueOnce('foo: bar');

      await expect(gate.check({
        projectPath: '/test/project',
      })).rejects.toThrow('tasks.yml 格式非法');
    });

    it('任务缺 id → 抛出格式错误', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - description: no id
`);

      await expect(gate.check({
        projectPath: '/test/project',
      })).rejects.toThrow('tasks[0] 缺 id');
    });

    it('acceptance 条目缺 description → 抛出格式错误', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - checked: true
`);

      await expect(gate.check({
        projectPath: '/test/project',
      })).rejects.toThrow('acceptance[0] 缺 description');
    });
  });

  describe('checkAllTasks mode', () => {
    it('should check all tasks when checkAllTasks is true', async () => {
      const allGate = new SpecAcceptanceGate({ checkAllTasks: true });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        checked: true
  - id: TASK-002
    acceptance:
      - description: Test 2
        checked: true
`);

      const result = await allGate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('All tasks pass');
    });

    it('should report failed tasks', async () => {
      const allGate = new SpecAcceptanceGate({ checkAllTasks: true });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        checked: true
  - id: TASK-002
    acceptance:
      - description: Test 2
        checked: false
`);

      const result = await allGate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('1 task(s) fail');
    });
  });

  describe('checkCompletedTasks mode', () => {
    it('should pass when no completed tasks', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    status: pending
`);

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('No completed tasks');
    });

    it('should check completed tasks only', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    status: done
    acceptance:
      - description: Test
        checked: true
  - id: TASK-002
    status: pending
    acceptance:
      - description: Test 2
        checked: false
`);

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('All completed tasks pass');
    });

    it('should respect completed flag', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    completed: true
    acceptance:
      - description: Test
        checked: true
`);

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('acceptance（未勾选判定）', () => {
    it('should pass when all acceptance checked', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test feature
        checked: true
      - description: Another test
        checked: true
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(result.details?.totalCriteria).toBe(2);
    });

    it('should fail when criteria unchecked (no e2e)', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Required criteria
        checked: false
      - description: Another required
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
      expect(result.details?.uncheckedCriteria).toHaveLength(2);
    });

    it('should pass when no acceptance criteria', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    description: Task without criteria
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('no acceptance criteria');
    });

    it('should run E2E test when specified', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test feature
        e2e_test: tests/example.spec.ts
        test_name: "should work"
`);

      mockExecFile.mockImplementationOnce((_file, _args, _opts, callback) => {
        callback(null, { stdout: '1 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(result.details?.e2eTestResults).toBeDefined();
      expect(result.details?.e2eTestResults?.[0]?.passed).toBe(true);
    });

    it('should fail when E2E test fails', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test feature
        e2e_test: tests/failing.spec.ts
`);

      mockExecFile.mockImplementationOnce((_file, _args, _opts, callback) => {
        callback(new Error('Test failed'), { stdout: '', stderr: 'Error' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
      expect(result.details?.e2eTestResults?.[0]?.passed).toBe(false);
      expect(result.details?.uncheckedCriteria).toContain('Test feature');
    });
  });

  describe('runE2ETest 判定接线（解析分支矩阵见 core/validators/__tests__/test-output.test.ts）', () => {
    it('should detect passed Playwright test', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExecFile.mockImplementationOnce((_file, _args, _opts, callback) => {
        callback(null, { stdout: '3 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
    });

    it('should detect failed Playwright test', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExecFile.mockImplementationOnce((_file, _args, _opts, callback) => {
        callback(null, { stdout: '1 failed, 2 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
    });
  });

  describe('E2E test configuration', () => {
    it('should use custom e2eTestCommand（可信命令串解析为 file + argv 前缀）', async () => {
      const customGate = new SpecAcceptanceGate({
        e2eTestCommand: 'npm run test:e2e',
      });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      let seenFile: string | undefined;
      let seenArgs: string[] | undefined;
      mockExecFile.mockImplementationOnce((file, args, _opts, callback) => {
        seenFile = file;
        seenArgs = args;
        callback(null, { stdout: 'passed', stderr: '' });
      });

      await customGate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(seenFile).toBe('npm');
      expect(seenArgs).toEqual(['run', 'test:e2e', 'test.spec.ts']);
    });

    it('should include test name as -g 后的独立 argv 元素', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
        test_name: "should login"
`);

      let seenArgs: string[] | undefined;
      mockExecFile.mockImplementationOnce((_file, args, _opts, callback) => {
        seenArgs = args;
        callback(null, { stdout: 'passed', stderr: '' });
      });

      await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(seenArgs).toEqual(['playwright', 'test', 'test.spec.ts', '-g', 'should login']);
    });
  });

  describe('E2E argv 直通（不经 shell，D1）', () => {
    const SPECIAL_FILE = 'tests/evil file$(touch /tmp/pwned);`id`&&echo "quoted".spec.ts';
    const SPECIAL_NAME = 'should run $(whoami) and `id`; "quoted" name';

    it('e2e_test 含特殊字符 → 整个字符串作为单个 argv 元素到达运行器', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: ${JSON.stringify(SPECIAL_FILE)}
`);

      let seenFile: string | undefined;
      let seenArgs: string[] | undefined;
      mockExecFile.mockImplementationOnce((file, args, _opts, callback) => {
        seenFile = file;
        seenArgs = args;
        callback(null, { stdout: '1 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(seenFile).toBe('npx');
      // 钉住：特殊字符不被拆词、不进命令串，整个字符串是 args 的最后一个元素
      expect(seenArgs).toEqual(['playwright', 'test', SPECIAL_FILE]);
    });

    it('test_name 含特殊字符 → -g 后整个字符串作为单个 argv 元素到达运行器', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
        test_name: ${JSON.stringify(SPECIAL_NAME)}
`);

      let seenArgs: string[] | undefined;
      mockExecFile.mockImplementationOnce((_file, args, _opts, callback) => {
        seenArgs = args;
        callback(null, { stdout: '1 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(seenArgs).toEqual(['playwright', 'test', 'test.spec.ts', '-g', SPECIAL_NAME]);
    });

    it('options 携带 cwd=projectPath 与 e2eTestTimeout', async () => {
      const timeoutGate = new SpecAcceptanceGate({ e2eTestTimeout: 60000 });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      let seenOpts: unknown;
      mockExecFile.mockImplementationOnce((_file, _args, opts, callback) => {
        seenOpts = opts;
        callback(null, { stdout: '1 passed', stderr: '' });
      });

      await timeoutGate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(seenOpts).toEqual({ cwd: '/test/project', timeout: 60000 });
    });

    it('超时被杀（无数字退出码）→ 判负', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExecFile.mockImplementationOnce((_file, _args, _opts, callback) => {
        callback(new Error('Command timed out after 120000ms'));
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
      expect(result.details?.e2eTestResults?.[0]?.passed).toBe(false);
    });

    it('可信命令串的引号与转义按 shell 词法解析进 argv（数据不经过同一入口）', async () => {
      const quotedGate = new SpecAcceptanceGate({
        e2eTestCommand: `npm run test:e2e -- --project "chromium x" --grep='a b'`,
      });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      let seenArgs: string[] | undefined;
      mockExecFile.mockImplementationOnce((_file, args, _opts, callback) => {
        seenArgs = args;
        callback(null, { stdout: '1 passed', stderr: '' });
      });

      await quotedGate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(seenArgs).toEqual([
        'run', 'test:e2e', '--', '--project', 'chromium x', '--grep=a b', 'test.spec.ts',
      ]);
    });
  });

  describe('custom tasksPath', () => {
    it('should use custom tasksPath from config', async () => {
      const customGate = new SpecAcceptanceGate({
        tasksPath: './custom.yml',
      });

      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
`);

      await customGate.check({
        projectPath: '/test/project',
      });

      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('custom.yml'),
        'utf-8'
      );
    });

    it('should use tasksPath from context', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
`);

      await gate.check({
        projectPath: '/test/project',
        tasksPath: '/custom/path/tasks.yml',
      });

      expect(mockFs.readFile).toHaveBeenCalledWith(
        '/custom/path/tasks.yml',
        'utf-8'
      );
    });
  });
});

describe('createSpecAcceptanceGate（内联工厂已随 #199 入口清空删除，等价构造直走类）', () => {
  it('should create gate instance', () => {
    const gate = new SpecAcceptanceGate();
    expect(gate).toBeInstanceOf(SpecAcceptanceGate);
  });

  it('should pass config to gate', () => {
    const gate = new SpecAcceptanceGate({
      e2eTestTimeout: 30000,
    });
    expect(gate).toBeDefined();
  });
});
