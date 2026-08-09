/**
 * check 命令 skip 输出形态测试（ADR-0001 P4）
 *
 * skipped 结果单独列示，不进 pass/fail 统计。
 */

import { check } from '../check';
import * as fs from 'fs';
import { constraintChecker } from '../../../core/constraints/checker';
import { ProjectConfigLoader } from '../../../core/project-config-loader';

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

// Mock constraintChecker
jest.mock('../../../core/constraints/checker', () => ({
  constraintChecker: {
    setCustomConfig: jest.fn(),
    setTraceRecorder: jest.fn(),
    checkConstraints: jest.fn(),
  },
}));

// Mock ProjectConfigLoader
jest.mock('../../../core/project-config-loader', () => ({
  ProjectConfigLoader: jest.fn().mockImplementation(() => ({
    load: jest.fn(),
    hasCustomConfig: jest.fn().mockReturnValue(false),
    mergeConstraints: jest.fn().mockReturnValue({ custom: [], disabled: [] }),
  })),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

const mockChecker = constraintChecker as jest.Mocked<typeof constraintChecker>;

function fakeConstraint(id: string, level: 'iron_law' | 'guideline') {
  return {
    kind: 'check' as const,
    id,
    rule: 'test',
    message: `msg-${id}`,
    level,
    trigger: 'code_implementation',
    enforcement: 'test',
  };
}

describe('check 命令 skip 输出', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = 0;
  });

  it('skipped 单独列示，不计入铁律通过条数', async () => {
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      ironLaws: [
        { id: 'law_pass', level: 'iron_law', satisfied: true, checkedAt: new Date(), constraint: fakeConstraint('law_pass', 'iron_law') },
        { id: 'law_skip', level: 'iron_law', satisfied: true, skipped: true, checkedAt: new Date(), constraint: fakeConstraint('law_skip', 'iron_law') },
      ],
      guidelines: [],
      tips: [],
      warningCount: 0,
      tipCount: 0,
    });

    await check({ preset: 'default', staged: false });

    // 通过条数只计实际评估的 1 条
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('铁律: 全部通过 (1 条)'));
    // skipped 单独列示
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('跳过评估: 1 条'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('- law_skip'));
    // skip 不影响整体通过
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('约束检查通过'));
  });

  it('指导原则通过计数排除 skipped', async () => {
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      ironLaws: [],
      guidelines: [
        { id: 'g_pass', level: 'guideline', satisfied: true, checkedAt: new Date(), constraint: fakeConstraint('g_pass', 'guideline') },
        { id: 'g_skip', level: 'guideline', satisfied: true, skipped: true, checkedAt: new Date(), constraint: fakeConstraint('g_skip', 'guideline') },
      ],
      tips: [],
      warningCount: 0,
      tipCount: 0,
    });

    await check({ preset: 'default', staged: false });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指导原则: 1/1 通过'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('跳过评估: 1 条'));
  });
});
