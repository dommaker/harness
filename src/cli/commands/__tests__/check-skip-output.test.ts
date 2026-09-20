/**
 * check 命令 skip 输出形态测试（ADR-0001 P4）
 *
 * skipped 结果单独列示，不进 pass/fail 统计。
 */

import { check } from '../check';
import { captureIO, type CapturingIO } from '../../command-contract';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

// Mock execAsync（getChangedFiles 失败 → 空变更列表）
jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn(),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(() => Buffer.from('')),
}));

// Mock checker：命令 per-run 构造 checker（harness#88），构造替身即控 checkConstraints 返回值
const mockChecker = { checkConstraints: jest.fn() };
jest.mock('../../../core/constraints/checker', () => ({
  ConstraintChecker: jest.fn(function () {
    return mockChecker;
  }),
}));

// 命令 per-run 锚根构造收集器（harness#139）：构造替身即拦截 trace 落盘
jest.mock('../../../monitoring/traces', () => ({
  TraceCollector: jest.fn(function () {
    return { record: jest.fn() };
  }),
}));

// Mock effective-constraints（ADR-0001：check 经 getMergedConstraintsConfig 走生效集链路）
jest.mock('../../../core/effective-constraints', () => ({
  getMergedConstraintsConfig: jest.fn().mockReturnValue({
    ironLaws: {},
    guidelines: {},
    prompts: {},
    custom: [],
    disabled: [],
    unknownIds: [],
  }),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

function fakeConstraint(id: string, severity: 'error' | 'warning') {
  return {
    kind: 'check' as const,
    id,
    rule: 'test',
    message: `msg-${id}`,
    severity,
    trigger: 'code_implementation',
    enforcement: 'test',
  };
}

describe('check 命令 skip 输出', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  it('skipped 单独列示，不计入 error 级通过条数', async () => {
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      errors: [
        { id: 'law_pass', severity: 'error', satisfied: true, checkedAt: new Date(), constraint: fakeConstraint('law_pass', 'error') },
        { id: 'law_skip', severity: 'error', satisfied: true, skipped: true, checkedAt: new Date(), constraint: fakeConstraint('law_skip', 'error') },
      ],
      warnings: [],
      warningCount: 0,
    });

    await check({ preset: 'default', staged: false }, io);

    // 通过条数只计实际评估的 1 条
    expect(io.outText()).toContain('error 级约束: 全部通过 (1 条)');
    // skipped 单独列示
    expect(io.outText()).toContain('跳过评估: 1 条');
    expect(io.outText()).toContain('- law_skip');
    // skip 不影响整体通过
    expect(io.outText()).toContain('约束检查通过');
  });

  it('warning 级通过计数排除 skipped', async () => {
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      errors: [],
      warnings: [
        { id: 'g_pass', severity: 'warning', satisfied: true, checkedAt: new Date(), constraint: fakeConstraint('g_pass', 'warning') },
        { id: 'g_skip', severity: 'warning', satisfied: true, skipped: true, checkedAt: new Date(), constraint: fakeConstraint('g_skip', 'warning') },
      ],
      warningCount: 0,
    });

    await check({ preset: 'default', staged: false }, io);

    expect(io.outText()).toContain('warning 级约束: 1/1 通过');
    expect(io.outText()).toContain('跳过评估: 1 条');
  });
});
