/**
 * 6 门禁统一接口行为测试（G1）
 *
 * 每个门禁的 evaluate(ctx) 收敛到统一 Gate 接口：
 * 执行细节私有，报告 GateResult → 三态 GateDecision（passed → abstain，失败 → deny），
 * 决策浅冻结。契约门禁（contract）的测试在 contract.test.ts。
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReviewGate } from '../review';
import { SecurityGate } from '../security';
import { PerformanceGate } from '../performance';
import { SpecAcceptanceGate } from '../acceptance';
import { CommandGate } from '../command';

// Mock exec（ReviewGate/SecurityGate 走 execAsync）
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

function callExec(cmd: string, _opts: unknown, callback: (err: unknown, res: { stdout: string }) => void): void {
  callback(null, { stdout: cmd.includes('@{u}') ? '' : 'abc123 commit msg' });
}

describe('ReviewGate 统一接口', () => {
  beforeEach(() => jest.clearAllMocks());

  it('本地模式 requireApproval=true → deny（三态映射 + 冻结）', async () => {
    mockExec.mockImplementation(callExec);
    const decision = await new ReviewGate().evaluate({
      projectId: 'p',
      projectPath: '/test/project',
    });
    expect(decision.status).toBe('deny');
    expect(decision.result.gate).toBe('review');
    expect(decision.result.passed).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('本地模式 requireApproval=false → abstain', async () => {
    mockExec.mockImplementation(callExec);
    const decision = await new ReviewGate({ requireApproval: false }).evaluate({
      projectId: 'p',
      projectPath: '/test/project',
    });
    expect(decision.status).toBe('abstain');
    expect(decision.result.passed).toBe(true);
  });

  it('id/order 字段齐备', () => {
    const gate = new ReviewGate();
    expect(gate.id).toBe('review');
    expect(gate.order).toBe(0);
  });
});

describe('SecurityGate 统一接口', () => {
  beforeEach(() => jest.clearAllMocks());

  it('npm audit 零漏洞 → abstain', async () => {
    mockExec.mockImplementation((_cmd, _opts, callback) =>
      callback(null, { stdout: JSON.stringify({ audit: { advisories: {} } }) })
    );
    const decision = await new SecurityGate().evaluate({
      projectId: 'p',
      projectPath: '/test/project',
    });
    expect(decision.status).toBe('abstain');
    expect(decision.result.passed).toBe(true);
  });

  it('发现 critical 漏洞 → deny', async () => {
    mockExec.mockImplementation((_cmd, _opts, callback) =>
      callback(null, {
        stdout: JSON.stringify({
          audit: {
            advisories: {
              '1': { severity: 'critical', name: 'bad-lib', via: [{ title: 'RCE' }] },
            },
          },
        }),
      })
    );
    const decision = await new SecurityGate().evaluate({
      projectId: 'p',
      projectPath: '/test/project',
    });
    expect(decision.status).toBe('deny');
    expect(decision.result.details?.critical).toBe(1);
  });

  it('id/order 字段齐备', () => {
    const gate = new SecurityGate();
    expect(gate.id).toBe('security');
    expect(gate.order).toBe(0);
  });
});

describe('PerformanceGate 统一接口', () => {
  it('enabled=false → abstain（禁用即放行）', async () => {
    const decision = await new PerformanceGate({ enabled: false }).evaluate({
      projectId: 'p',
      projectPath: '/test/project',
    });
    expect(decision.status).toBe('abstain');
    expect(decision.result.passed).toBe(true);
  });

  it('id/order 字段齐备', () => {
    const gate = new PerformanceGate();
    expect(gate.id).toBe('performance');
    expect(gate.order).toBe(0);
  });
});

describe('SpecAcceptanceGate 统一接口', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gate-acc-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('tasks.yml 不存在 → abstain（跳过）', async () => {
    const decision = await new SpecAcceptanceGate().evaluate({
      projectId: 'p',
      projectPath: dir,
      tasksPath: path.join(dir, 'no-such-tasks.yml'),
    });
    expect(decision.status).toBe('abstain');
    expect(decision.result.passed).toBe(true);
    expect(decision.result.gate).toBe('acceptance');
  });

  it('已完成任务验收标准未勾选 → deny', async () => {
    const tasksPath = path.join(dir, 'tasks.yml');
    fs.writeFileSync(
      tasksPath,
      [
        'tasks:',
        '  - id: TASK-001',
        '    status: done',
        '    acceptance_criteria:',
        '      - id: AC-001',
        '        description: Test',
        '        type: manual',
        '        required: true',
        '        checked: false',
      ].join('\n')
    );
    const decision = await new SpecAcceptanceGate().evaluate({
      projectId: 'p',
      projectPath: dir,
      tasksPath,
    });
    expect(decision.status).toBe('deny');
    expect(decision.result.passed).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('id/order 字段齐备', () => {
    const gate = new SpecAcceptanceGate();
    expect(gate.id).toBe('acceptance');
    expect(gate.order).toBe(0);
  });
});

describe('CommandGate 统一接口', () => {
  it('黑名单命令 → deny', async () => {
    const decision = await new CommandGate().evaluate({
      projectId: 'p',
      projectPath: '/test/project',
      command: 'rm -rf /',
    });
    expect(decision.status).toBe('deny');
    expect(decision.result.passed).toBe(false);
  });

  it('安全命令 → abstain', async () => {
    const decision = await new CommandGate().evaluate({
      projectId: 'p',
      projectPath: '/test/project',
      command: 'echo hello',
    });
    expect(decision.status).toBe('abstain');
    expect(decision.result.passed).toBe(true);
  });

  it('id/order 字段齐备', () => {
    const gate = new CommandGate();
    expect(gate.id).toBe('command');
    expect(gate.order).toBe(0);
  });
});
