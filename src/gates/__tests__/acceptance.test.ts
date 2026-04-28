/**
 * SpecAcceptanceGate 测试
 */

import { SpecAcceptanceGate, createSpecAcceptanceGate } from '../acceptance';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExec = exec as unknown as jest.Mock;

describe('SpecAcceptanceGate', () => {
  let gate: SpecAcceptanceGate;

  beforeEach(() => {
    jest.clearAllMocks();
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
    acceptance_criteria:
      - id: AC-001
        description: Test criteria
        type: manual
        required: true
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

    it('should handle YAML parse error', async () => {
      mockFs.readFile.mockResolvedValueOnce('invalid: yaml: content: [');

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Acceptance gate error');
    });
  });

  describe('checkAllTasks mode', () => {
    it('should check all tasks when checkAllTasks is true', async () => {
      const allGate = new SpecAcceptanceGate({ checkAllTasks: true });
      
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance_criteria:
      - id: AC-001
        description: Test
        type: manual
        required: true
        checked: true
  - id: TASK-002
    acceptance_criteria:
      - id: AC-002
        description: Test 2
        type: manual
        required: true
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
    acceptance_criteria:
      - id: AC-001
        description: Test
        type: manual
        required: true
        checked: true
  - id: TASK-002
    acceptance_criteria:
      - id: AC-002
        description: Test 2
        type: manual
        required: true
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
    acceptance_criteria:
      - id: AC-001
        description: Test
        type: manual
        required: true
        checked: true
  - id: TASK-002
    status: pending
    acceptance_criteria:
      - id: AC-002
        description: Test 2
        type: manual
        required: true
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
    acceptance_criteria:
      - id: AC-001
        description: Test
        type: manual
        required: true
        checked: true
`);

      const result = await gate.check({
        projectPath: '/test/project',
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('acceptance_criteria (legacy format)', () => {
    it('should pass when all required criteria checked', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance_criteria:
      - id: AC-001
        description: Test criteria
        type: manual
        required: true
        checked: true
      - id: AC-002
        description: Optional criteria
        type: manual
        required: false
        checked: false
`);

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
      expect(result.details?.checkedCriteria).toBe(1);
    });

    it('should fail when required criteria unchecked', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance_criteria:
      - id: AC-001
        description: Required criteria
        type: manual
        required: true
        checked: false
      - id: AC-002
        description: Another required
        type: manual
        required: true
        checked: false
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
  });

  describe('acceptance (new format with E2E tests)', () => {
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

    it('should run E2E test when specified', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test feature
        e2e_test: tests/example.spec.ts
        test_name: "should work"
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
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

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Test failed'), { stdout: '', stderr: 'Error' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('E2E test failed');
    });
  });

  describe('parseTestOutput()', () => {
    it('should detect passed Playwright test', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
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

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: '1 failed, 2 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
    });

    it('should detect passed Jest test', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: 'Test Suites: 0 failed, 5 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
    });

    it('should detect failed Jest test', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: 'Test Suites: 2 failed, 3 passed', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
    });

    it('should detect PASS in generic output', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: 'PASS test.js', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(true);
    });

    it('should detect FAIL in generic output', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: 'PASS test1.js\nFAIL test2.js', stderr: '' });
      });

      const result = await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
    });
  });

  describe('E2E test configuration', () => {
    it('should use custom e2eTestCommand', async () => {
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

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        expect(cmd).toContain('npm run test:e2e');
        callback(null, { stdout: 'passed', stderr: '' });
      });

      await customGate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });
    });

    it('should include test name with -g flag', async () => {
      mockFs.readFile.mockResolvedValueOnce(`
tasks:
  - id: TASK-001
    acceptance:
      - description: Test
        e2e_test: test.spec.ts
        test_name: "should login"
`);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        expect(cmd).toContain('-g "should login"');
        callback(null, { stdout: 'passed', stderr: '' });
      });

      await gate.check({
        projectPath: '/test/project',
        taskId: 'TASK-001',
      });
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

describe('createSpecAcceptanceGate', () => {
  it('should create gate instance', () => {
    const gate = createSpecAcceptanceGate();
    expect(gate).toBeInstanceOf(SpecAcceptanceGate);
  });

  it('should pass config to gate', () => {
    const gate = createSpecAcceptanceGate({
      e2eTestTimeout: 30000,
    });
    expect(gate).toBeDefined();
  });
});
