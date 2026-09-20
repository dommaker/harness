/**
 * status 命令补充测试
 *
 * ADR-0020 起不再 mock TraceAnalyzer/TraceCollector：异常判定走真实纯函数，
 * 用例喂能真的判出异常的 trace（passRate < 0.3 → low_pass_rate）。
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
    .map((t, i) => JSON.stringify({ severity: 'error', timestamp: i + 1, result: 'pass', ...t }))
    .join('\n');
}

/** n 条同一约束的 pass/fail 记录 */
function repeats(constraintId: string, n: number, result: ExecutionTrace['result']): Array<Partial<ExecutionTrace>> {
  return Array.from({ length: n }, () => ({ constraintId, result }));
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

/** 内存 StateIO 假件（ADR-0026）：缺省 fileStateIO 在全 mock 的 fs 下会吃到 trace 假数据 */
function memoryStateIO(initial: HarnessState = {}): StateIO & { snapshot(): HarnessState } {
  let state = initial;
  return {
    read: () => state,
    write: (next: HarnessState) => { state = next; },
    snapshot: () => state,
  };
}

/** 全部用例经注入假件调用 status */
function runStatus(options: StatusOptions = {}): Promise<CommandResult> {
  return status({ stateIO: memoryStateIO(), ...options }, io);
}

describe('status command - 补充覆盖', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation();
    mockFs.mkdirSync.mockImplementation();
  });

  describe('异常检测完整流程', () => {
    it('有异常时应该显示详细信息和下一步建议', async () => {
      // 两个约束各自全失败 → 各自判出一枚 low_pass_rate
      mockFs.readFileSync.mockReturnValue(traceFile([
        ...repeats('docs_freshness', 2, 'fail'),
        ...repeats('no_completion_without_verification', 2, 'fail'),
      ]));

      await runStatus({ anomalies: true });

      const output = io.outText();
      expect(output).toContain('发现 2 个异常');
      expect(output).toContain('no_completion_without_verification');
      expect(output).toContain('类型: low_pass_rate');
      expect(output).toContain('下一步建议');
    });

    it('无异常时应该显示未发现异常', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test', result: 'pass' },
      ]));

      await runStatus({ anomalies: true });

      expect(io.outText()).toContain('✅ 未发现异常');
    });
  });

  describe('约束级别统计', () => {
    it('应该显示 error 级约束统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'docs_freshness' },
        { constraintId: 'no_completion_without_verification' },
      ]));

      await runStatus();

      const output = io.outText();
      expect(output).toContain('📈 约束统计:');
      expect(output).toContain('🔴 error 级约束:');
      expect(output).toContain('✅ no_completion_without_verification');
    });

    it('应该显示 warning 级约束统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'capability_sync', severity: 'warning', result: 'pass' },
      ]));

      await runStatus();

      expect(io.outText()).toContain('🟡 warning 级约束:');
    });
  });

  describe('详细模式扩展', () => {
    it('详细模式应该显示所有级别详情', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'docs_freshness', severity: 'error' },
        { constraintId: 'capability_sync', severity: 'warning' },
        { constraintId: 'capability_sync', severity: 'warning' },
      ]));

      await runStatus({ detail: true });

      const output = io.outText();
      expect(output).toContain('📈 约束统计:');
      expect(output).toContain('🔴 error 级约束:');
      expect(output).toContain('🟡 warning 级约束:');
      expect(output).toContain('检查: 2 | 通过: 100% | 失败: 0%');
    });
  });

  describe('JSON parse 异常处理', () => {
    it('无效 JSON 行应该被过滤', async () => {
      mockFs.readFileSync.mockReturnValue(
        ['invalid json', JSON.stringify({ constraintId: 'valid', severity: 'error', timestamp: 1, result: 'pass' }), 'also invalid'].join('\n')
      );

      await runStatus();

      // 应该成功处理，不会抛出异常：坏行进 stderr 告知，合法行进统计
      const output = io.outText();
      expect(output).toContain('记录数: 3 条');
      expect(output).toContain('✅ valid');
      expect(io.errText()).toContain('2 行损坏');
    });
  });
});
