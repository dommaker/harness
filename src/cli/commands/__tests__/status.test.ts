/**
 * status 命令测试
 *
 * ADR-0020 起不再 mock TraceAnalyzer/TraceCollector：统计与异常由 trace-analyzer
 * 的模块级纯函数真算，用例喂合法 trace 行、断言真实输出。
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
      await status({}, io);
      expect(io.outText()).toContain('未初始化');
    });
  });

  describe('无 trace 记录', () => {
    it('应该显示暂无记录提示', async () => {
      // harness dir 存在，但 traces 文件不存在
      mockFs.existsSync
        .mockReturnValueOnce(true) // .harness dir
        .mockReturnValueOnce(false); // traces file

      await status({}, io);
      expect(io.outText()).toContain('暂无 Trace');
    });
  });

  describe('正常状态显示', () => {
    it('应该显示记录数', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test1' },
        { constraintId: 'test2', level: 'guideline' },
      ]));

      await status({}, io);
      expect(io.outText()).toContain('记录数: 2 条');
      expect(io.outText()).toContain('📈 约束统计:');
    });

    it('应该显示 Iron Laws 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'no_bypass_checkpoint' },
      ]));

      await status({ detail: true }, io);
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

      await status({ anomalies: true }, io);
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

      await status({ detail: true }, io);
      expect(io.outText()).toContain('检查: 5 | 通过: 80% | 失败: 20%');
    });
  });

  describe('状态文件更新', () => {
    it('应该更新 .state.json', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await status({}, io);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Guidelines 统计', () => {
    it('应该显示 Guidelines 统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test_guide', level: 'guideline' },
      ]));

      await status({}, io);
      expect(io.outText()).toContain('🟡 Guidelines:');
      expect(io.outText()).toContain('✅ test_guide');
    });
  });

  describe('异常模式', () => {
    it('应该显示未发现异常当无异常', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await status({ anomalies: true }, io);
      expect(io.outText()).toContain('✅ 未发现异常');
    });

    it('应该显示异常详情', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test', result: 'fail' },
      ]));

      await status({ anomalies: true }, io);
      expect(io.outText()).toContain('当前值: 0');
      expect(io.outText()).toContain('阈值: 0.3');
      expect(io.outText()).toContain('下一步建议');
    });
  });

  describe('建议', () => {
    it('应该显示良好建议当 trace >= 100', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile(repeats('test', 100, 'pass')));

      await status({}, io);
      expect(io.outText()).toContain('记录数: 100 条');
      expect(io.outText()).toContain('状态良好');
    });

    it('应该显示积累数据建议当 trace < 100', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([{ constraintId: 'test' }]));

      await status({}, io);
      expect(io.outText()).toContain('继续积累数据');
    });

    it('应该显示诊断建议当有异常', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        { constraintId: 'test', result: 'fail' },
      ]));

      await status({ anomalies: true }, io);
      expect(io.outText()).toContain('harness status --detail');
    });
  });

  describe('详细模式扩展', () => {
    it('应该显示 Guidelines 详细统计', async () => {
      mockFs.readFileSync.mockReturnValue(traceFile([
        ...repeats('test_guide', 3, 'pass'),
        ...repeats('test_guide', 2, 'fail'),
      ].map(t => ({ ...t, level: 'guideline' as const }))));

      await status({ detail: true }, io);
      expect(io.outText()).toContain('⚠️ test_guide');
      expect(io.outText()).toContain('检查: 5 | 通过: 60% | 失败: 40%');
    });
  });
});
