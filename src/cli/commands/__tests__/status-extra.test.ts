/**
 * status 命令补充测试
 *
 * ADR-0020 起不再 mock TraceAnalyzer/TraceCollector：异常判定走真实纯函数，
 * 用例喂能真的判出异常的 trace（passRate < 0.3 → low_pass_rate）。
 */

import { status } from '../status';
import { captureIO, type CapturingIO } from '../../command-contract';
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
beforeEach(() => {
  io = captureIO();
});

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
        ...repeats('no_bypass_checkpoint', 2, 'fail'),
        ...repeats('no_completion_without_verification', 2, 'fail'),
      ]));

      await status({ anomalies: true }, io);

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

      await status({ anomalies: true }, io);

      expect(io.outText()).toContain('✅ 未发现异常');
    });
  });

  describe('约束级别统计', () => {
    it('应该显示 Iron Laws 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'no_bypass_checkpoint' },
        { constraintId: 'no_completion_without_verification' },
      ]));

      await status({}, io);

      const output = io.outText();
      expect(output).toContain('📈 约束统计:');
      expect(output).toContain('🔴 Iron Laws:');
      expect(output).toContain('✅ no_completion_without_verification');
    });

    it('应该显示 Guidelines 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'capability_sync', level: 'guideline', result: 'pass' },
      ]));

      await status({}, io);

      expect(io.outText()).toContain('🟡 Guidelines:');
    });
  });

  describe('详细模式扩展', () => {
    it('详细模式应该显示所有级别详情', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law' },
        { constraintId: 'capability_sync', level: 'guideline' },
        { constraintId: 'capability_sync', level: 'guideline' },
      ]));

      await status({ detail: true }, io);

      const output = io.outText();
      expect(output).toContain('📈 约束统计:');
      expect(output).toContain('🔴 Iron Laws:');
      expect(output).toContain('🟡 Guidelines:');
      expect(output).toContain('检查: 2 | 通过: 100% | 失败: 0%');
    });
  });

  describe('JSON parse 异常处理', () => {
    it('无效 JSON 行应该被过滤', async () => {
      mockFs.readFileSync.mockReturnValue(
        ['invalid json', JSON.stringify({ constraintId: 'valid', level: 'iron_law', timestamp: 1, result: 'pass' }), 'also invalid'].join('\n')
      );

      await status({}, io);

      // 应该成功处理，不会抛出异常：坏行进 stderr 告知，合法行进统计
      const output = io.outText();
      expect(output).toContain('记录数: 3 条');
      expect(output).toContain('✅ valid');
      expect(io.errText()).toContain('2 行损坏');
    });
  });
});
