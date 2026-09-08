/**
 * command 命令测试
 *
 * 判定经返回值断言（架构评审候选7）：退出码不再靠 spyOn(process,'exit')，
 * 输出文本走注入 captureIO。
 */

import { executeCommand } from '../command';
import { createCommandGate, getCommandRiskLevel } from '../../../gates';
import { captureIO, type CapturingIO } from '../../command-contract';

jest.mock('../../../gates', () => ({
  createCommandGate: jest.fn(),
  getCommandRiskLevel: jest.fn(),
  DEFAULT_COMMAND_BLACKLIST: [
    { id: 'rule-1', level: 'block', message: 'No rm -rf', category: 'destructive', pattern: 'rm -rf' },
    { id: 'rule-2', level: 'warn', message: 'No DROP TABLE', category: 'database', pattern: 'DROP TABLE' },
  ],
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

const mockCreateGate = createCommandGate as jest.MockedFunction<typeof createCommandGate>;
const mockGetRisk = getCommandRiskLevel as jest.MockedFunction<typeof getCommandRiskLevel>;

function mockGate(check: jest.Mock): void {
  mockCreateGate.mockReturnValue({ check } as any);
}

/** 从捕获输出里取第一条可解析为该形状的 JSON 行 */
function parseJsonLine(lines: string[], predicate: (parsed: any) => boolean): any {
  for (const line of lines.join('\n').split('\n\n')) {
    try {
      const parsed = JSON.parse(line);
      if (predicate(parsed)) return parsed;
    } catch { /* 非 JSON 行 */ }
  }
  return undefined;
}

describe('command command', () => {
  let io: CapturingIO;

  beforeEach(() => {
    jest.clearAllMocks();
    io = captureIO();
  });

  describe('--list', () => {
    it('按类别分组列出规则并返回 ok', async () => {
      const result = await executeCommand(undefined, { list: true }, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(io.outText()).toContain('命令黑名单规则');
      expect(io.outLines()).toEqual(
        expect.arrayContaining([expect.stringContaining('[destructive]'), expect.stringContaining('[database]')]),
      );
    });

    it('--json 列出规则数组', async () => {
      const result = await executeCommand(undefined, { list: true, json: true }, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(parseJsonLine(io.outLines(), Array.isArray)).toHaveLength(2);
    });
  });

  describe('no command', () => {
    it('缺参数：usage-error + 原因，并提示用法', async () => {
      const result = await executeCommand(undefined, {}, io);

      expect(result).toEqual({
        kind: 'usage-error',
        reason: expect.stringContaining('缺少要检查的命令参数'),
      });
      expect(io.errText()).toContain('请提供要检查的命令');
      expect(io.outText()).toBe('');
    });
  });

  describe('default mode', () => {
    it('放行：ok，打印 ✓', async () => {
      mockGate(jest.fn().mockResolvedValue({ passed: true, message: 'OK' }));

      const result = await executeCommand('safe-cmd', {}, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(io.outText()).toContain('✓');
    });

    it('拒绝：fail + 裁决原因，打印 ✗', async () => {
      mockGate(jest.fn().mockResolvedValue({ passed: false, message: 'Blocked' }));

      const result = await executeCommand('rm -rf /', {}, io);

      expect(result).toEqual({ kind: 'fail', reason: expect.stringContaining('Blocked') });
      expect(io.outText()).toContain('✗');
    });

    it('--json 输出裁决详情', async () => {
      mockGate(jest.fn().mockResolvedValue({ passed: true, message: 'OK', details: {} }));

      await executeCommand('cmd', { json: true }, io);

      expect(parseJsonLine(io.outLines(), (p: any) => p.command === 'cmd')).toEqual({
        command: 'cmd',
        passed: true,
        message: 'OK',
        details: {},
      });
    });
  });

  describe('--level', () => {
    it('low：ok，打印等级', async () => {
      mockGetRisk.mockReturnValue('low');
      mockGate(jest.fn().mockResolvedValue({ passed: true, message: 'OK' }));

      const result = await executeCommand('safe-cmd', { level: true }, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(io.outText()).toContain('low');
    });

    it('high：fail + 等级原因（严重级条件式译成 kind）', async () => {
      mockGetRisk.mockReturnValue('high');
      mockGate(jest.fn().mockResolvedValue({ passed: true, message: 'OK' }));

      const result = await executeCommand('rm -rf /', { level: true }, io);

      expect(result).toEqual({ kind: 'fail', reason: expect.stringContaining('risk level is high') });
    });

    it('high 等级不再执行黑名单裁决分支', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockGetRisk.mockReturnValue('high');
      mockGate(mockCheck);

      const result = await executeCommand('rm -rf /', { level: true }, io);

      // 历史行为：--level 命中即退出，不再打印 pass/fail 行
      expect(result.kind).toBe('fail');
      expect(io.outText()).not.toContain('✓');
    });

    it('--json 输出等级', async () => {
      mockGetRisk.mockReturnValue('medium');
      mockGate(jest.fn().mockResolvedValue({ passed: true, message: 'OK' }));

      await executeCommand('cmd', { level: true, json: true }, io);

      expect(parseJsonLine(io.outLines(), (p: any) => p.level !== undefined)).toEqual({
        level: 'medium',
        command: 'cmd',
      });
    });
  });
});
