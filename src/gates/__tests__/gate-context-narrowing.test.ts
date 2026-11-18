/**
 * P1.4：收窄 GateContext
 *
 * 共享上下文只留 projectPath/taskId/runEnv；六种门禁的专属输入字段
 * （prNumber / securityScanCommand / performanceThresholds /
 *   oldContractPath / newContractPath / command / tasksPath）
 * 只出现在各门禁自己的输入类型（XxxGateContext）里，统一 evaluate → GateDecision
 * 协议不变。
 *
 * 红绿分界：旧实现下 GateContext 仍带全部专属字段——本文件的 @ts-expect-error
 * 编译期钉全部变 unused（ts-jest 编译红），且各 XxxGateContext 符号不存在
 * （import 即红），源码闸同时命中；行为钉证明配置仍走各门禁输入/构造器。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import type {
  GateContext,
  ReviewGateContext,
  SecurityGateContext,
  PerformanceGateContext,
  ContractGateContext,
  CommandGateContext,
  AcceptanceGateContext,
} from '../types';
import { CommandGate } from '../command';
import { SecurityGate } from '../security';

// 缝替身：只替换 execAsync（SecurityGate 走它下发扫描命令），模块其余导出保持真实
jest.mock('../../utils/exec', () => {
  const actual = jest.requireActual('../../utils/exec');
  return { ...actual, execAsync: jest.fn() };
});

const mockExecAsync = execAsync as unknown as jest.Mock;

describe('GateContext 收窄（P1.4）', () => {
  it('共享上下文不再接受门禁专属字段（编译期钉，旧实现下 @ts-expect-error 全变 unused）', () => {
    const base = { projectPath: '/tmp/proj' };
    // @ts-expect-error prNumber 是 review 门禁专属输入（P1.4）
    const c1: GateContext = { ...base, prNumber: 123 };
    // @ts-expect-error securityScanCommand 是 security 门禁专属输入（P1.4）
    const c2: GateContext = { ...base, securityScanCommand: 'yarn audit --json' };
    // @ts-expect-error performanceThresholds 是 performance 门禁专属输入（P1.4）
    const c3: GateContext = { ...base, performanceThresholds: { minCoverage: 80 } };
    // @ts-expect-error oldContractPath 是 contract 门禁专属输入（P1.4）
    const c4: GateContext = { ...base, oldContractPath: '/tmp/old.yaml' };
    // @ts-expect-error newContractPath 是 contract 门禁专属输入（P1.4）
    const c5: GateContext = { ...base, newContractPath: '/tmp/new.yaml' };
    // @ts-expect-error command 是 command 门禁专属输入（P1.4）
    const c6: GateContext = { ...base, command: 'rm -rf /' };
    // @ts-expect-error tasksPath 是 acceptance 门禁专属输入（P1.4）
    const c7: GateContext = { ...base, tasksPath: '/tmp/tasks.yml' };
    expect([c1, c2, c3, c4, c5, c6, c7]).toHaveLength(7);
  });

  it('各门禁输入类型接受自己的专属字段（编译期钉，旧实现下符号不存在 import 即红）', () => {
    const review: ReviewGateContext = { projectPath: '/p', taskId: 'T', prNumber: 1 };
    const security: SecurityGateContext = { projectPath: '/p', securityScanCommand: 'yarn audit --json' };
    const performance: PerformanceGateContext = { projectPath: '/p', performanceThresholds: { minCoverage: 80 } };
    const contract: ContractGateContext = { projectPath: '/p', oldContractPath: 'a.yaml', newContractPath: 'b.yaml' };
    const command: CommandGateContext = { projectPath: '/p', command: 'ls' };
    const acceptance: AcceptanceGateContext = { projectPath: '/p', taskId: 'T', tasksPath: 'tasks.yml' };
    expect([review, security, performance, contract, command, acceptance]).toHaveLength(6);
  });

  it('gates/types.ts：GateContext 接口体不再出现门禁专属字段，各字段归位到专属输入类型', () => {
    const source = fs.readFileSync(path.join(__dirname, '../types.ts'), 'utf-8');
    const body = source.match(/export interface GateContext \{([\s\S]*?)\n\}/)?.[1] ?? '';
    for (const field of [
      'prNumber',
      'securityScanCommand',
      'performanceThresholds',
      'oldContractPath',
      'newContractPath',
      'command',
      'tasksPath',
    ]) {
      expect(body).not.toContain(field);
    }
    expect(source).toMatch(/export interface ReviewGateContext extends GateContext \{[^}]*prNumber\?/);
    expect(source).toMatch(/export interface SecurityGateContext extends GateContext \{[^}]*securityScanCommand\?/);
    expect(source).toMatch(/export interface PerformanceGateContext extends GateContext \{[^}]*performanceThresholds\?/);
    expect(source).toMatch(/export interface ContractGateContext extends GateContext \{[^}]*oldContractPath\?[^}]*newContractPath\?/);
    expect(source).toMatch(/export interface CommandGateContext extends GateContext \{[^}]*command: string/);
    expect(source).toMatch(/export interface AcceptanceGateContext extends GateContext \{[^}]*tasksPath\?/);
  });
});

describe('配置仍走各门禁输入/构造器（P1.4 行为钉）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockImplementation(() =>
      Promise.resolve({ stdout: JSON.stringify({ vulnerabilities: {} }), stderr: '' })
    );
  });

  it('CommandGate：构造器 ignoreCategories 经 evaluate 生效（无 IO 纯判定）', async () => {
    const blocked = await new CommandGate().evaluate({ projectPath: '/p', command: 'git push --force' });
    expect(blocked.status).toBe('deny');

    const ignored = await new CommandGate({ ignoreCategories: ['git'] }).evaluate({
      projectPath: '/p',
      command: 'git push --force',
    });
    expect(ignored.status).toBe('abstain');
  });

  it('SecurityGate：构造器 scanCommand 在输入未提供时经 evaluate 生效', async () => {
    const decision = await new SecurityGate({ scanCommand: 'pnpm audit --json' }).evaluate({
      projectPath: '/p',
    });

    expect(mockExecAsync.mock.calls.map((c) => String(c[0]))).toEqual(['pnpm audit --json']);
    expect(decision.status).toBe('abstain');
  });

  it('SecurityGate：输入字段 securityScanCommand 优先于构造器 scanCommand', async () => {
    const decision = await new SecurityGate({ scanCommand: 'pnpm audit --json' }).evaluate({
      projectPath: '/p',
      securityScanCommand: 'yarn audit --json',
    });

    expect(mockExecAsync.mock.calls.map((c) => String(c[0]))).toEqual(['yarn audit --json']);
    expect(decision.status).toBe('abstain');
  });
});
