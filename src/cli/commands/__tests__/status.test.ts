/**
 * status 命令测试
 *
 * ADR-0020 起不再 mock TraceAnalyzer/TraceCollector：统计与异常由 trace-analyzer
 * 的模块级纯函数真算，用例喂合法 trace 行、断言真实输出。
 * ADR-0026 起状态文件读写经注入的 StateIO 假件，不碰（被 mock 的）fs。
 */

import { status, type StatusOptions } from '../status';
import { captureIO, type CapturingIO, type CommandResult } from '../../command-contract';
import type { HarnessState, StateIO } from '../../state-io';
import * as fs from 'fs';
import type { ExecutionTrace } from '../../../types/trace';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

/** trace 文件内容：一 trace 一行，缺省字段补齐成合法 ExecutionTrace（timestamp 递增） */
function traceFile(traces: Array<Partial<ExecutionTrace>>): string {
  return traces
    .map((t, i) => JSON.stringify({ level: 'iron_law', timestamp: i + 1, result: 'pass', ...t }))
    .join('\n');
}

/** n 条同一约束的 pass/fail 记录 */
function repeats(constraintId: string, n: number, result: ExecutionTrace['result']): Array<Partial<ExecutionTrace>> {
  return Array.from({ length: n }, () => ({ constraintId, result }));
}

let io: CapturingIO;
let stateIO: ReturnType<typeof memoryStateIO>;
beforeEach(() => {
  io = captureIO();
  stateIO = memoryStateIO();
});

/** 内存 StateIO 假件（ADR-0026）：状态读写走注入面，缺省 fileStateIO 在全 mock 的 fs 下会吃到 trace 假数据 */
function memoryStateIO(initial: HarnessState = {}): StateIO & { snapshot(): HarnessState } {
  let state = initial;
  return {
    read: () => state,
    write: (next: HarnessState) => { state = next; },
    snapshot: () => state,
  };
}

/** 全部用例经注入假件调用 status（stateIO 可被单例覆盖以预置状态） */
function runStatus(options: StatusOptions = {}): Promise<CommandResult> {
  return status({ stateIO, ...options }, io);
}

describe('status command', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation();
    mockFs.mkdirSync.mockImplementation();
  });

  describe('未初始化情况', () => {
    it('应该显示未初始化提示', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await runStatus();
      expect(io.outText()).toContain('未初始化');
    });
  });

  describe('无 trace 记录', () => {
    it('应该显示暂无记录提示', async () => {
      // harness dir 存在，但 traces 文件不存在
      mockFs.existsSync
        .mockReturnValueOnce(true) // .harness dir
        .mockReturnValueOnce(false); // traces file

      await runStatus();
      expect(io.outText()).toContain('暂无 Trace');
    });
  });

  describe('正常状态显示', () => {
    it('应该显示记录数', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test1' },
        { constraintId: 'test2', level: 'guideline' },
      ]));

      await runStatus();
      expect(io.outText()).toContain('记录数: 2 条');
      expect(io.outText()).toContain('📈 约束统计:');
    });

    it('应该显示 Iron Laws 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'no_bypass_checkpoint' },
      ]));

      await runStatus({ detail: true });
      expect(io.outText()).toContain('🔴 Iron Laws:');
      expect(io.outText()).toContain('✅ no_bypass_checkpoint');
      expect(io.outText()).toContain('检查: 1 | 通过: 100% | 失败: 0%');
    });
  });

  describe('异常检测', () => {
    it('应该显示异常列表', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test1', result: 'fail' },
      ]));

      await runStatus({ anomalies: true });
      expect(io.outText()).toContain('发现 1 个异常');
      expect(io.outText()).toContain('  test1');
      expect(io.outText()).toContain('类型: low_pass_rate');
    });
  });

  describe('详细模式', () => {
    it('应该显示详细统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        ...repeats('test1', 4, 'pass'),
        { constraintId: 'test1', result: 'fail' },
      ]));

      await runStatus({ detail: true });
      expect(io.outText()).toContain('检查: 5 | 通过: 80% | 失败: 20%');
    });
  });

  describe('状态文件更新', () => {
    it('应该经 StateIO 写入 lastStatusRun', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await runStatus();
      expect(stateIO.snapshot().lastStatusRun).toBeTruthy();
    });

    it('读-改-写：已有的 shownHints 不被 status 抹掉（ADR-0026 决策 2 的行为修复）', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));
      stateIO = memoryStateIO({ shownHints: ['trace_50'] });

      await runStatus();
      expect(stateIO.snapshot().shownHints).toEqual(['trace_50']);
      expect(stateIO.snapshot().lastStatusRun).toBeTruthy();
    });
  });

  describe('Guidelines 统计', () => {
    it('应该显示 Guidelines 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test_guide', level: 'guideline' },
      ]));

      await runStatus();
      expect(io.outText()).toContain('🟡 Guidelines:');
      expect(io.outText()).toContain('✅ test_guide');
    });
  });

  describe('异常模式', () => {
    it('应该显示未发现异常当无异常', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await runStatus({ anomalies: true });
      expect(io.outText()).toContain('✅ 未发现异常');
    });

    it('应该显示异常详情', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test', result: 'fail' },
      ]));

      await runStatus({ anomalies: true });
      expect(io.outText()).toContain('当前值: 0');
      expect(io.outText()).toContain('阈值: 0.3');
      expect(io.outText()).toContain('下一步建议');
    });
  });

  describe('建议', () => {
    it('应该显示良好建议当 trace >= 100', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile(repeats('test', 100, 'pass')));

      await runStatus();
      expect(io.outText()).toContain('记录数: 100 条');
      expect(io.outText()).toContain('状态良好');
    });

    it('应该显示积累数据建议当 trace < 100', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await runStatus();
      expect(io.outText()).toContain('继续积累数据');
    });

    it('应该显示诊断建议当有异常', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test', result: 'fail' },
      ]));

      await runStatus({ anomalies: true });
      expect(io.outText()).toContain('harness status --detail');
    });
  });

  describe('详细模式扩展', () => {
    it('应该显示 Guidelines 详细统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        ...repeats('test_guide', 3, 'pass'),
        ...repeats('test_guide', 2, 'fail'),
      ].map(t => ({ ...t, level: 'guideline' as const }))));

      await runStatus({ detail: true });
      expect(io.outText()).toContain('⚠️ test_guide');
      expect(io.outText()).toContain('检查: 5 | 通过: 60% | 失败: 40%');
    });
  });
});
