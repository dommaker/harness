/**
 * command 命令测试
 */

import { executeCommand } from '../command';
import { createCommandGate, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST } from '../../../gates';

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

describe('command command', () => {
  let consoleSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('--list', () => {
    it('should list rules grouped by category', async () => {
      await executeCommand(undefined, { list: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('命令黑名单规则'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[destructive]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[database]'));
    });

    it('should list rules as JSON when --json', async () => {
      await executeCommand(undefined, { list: true, json: true });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try { return Array.isArray(JSON.parse(c[0])); } catch { return false; }
      });
      expect(jsonCall).toBeTruthy();
      const parsed = JSON.parse(jsonCall[0]);
      expect(parsed).toHaveLength(2);
    });
  });

  describe('no command', () => {
    it('should print error and exit 1 when no command provided', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand(undefined, {});

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('请提供要检查的命令'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('default mode', () => {
    it('should print pass when result passes', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('safe-cmd', {});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    });

    it('should print fail and exit 1 when result fails', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: false, message: 'Blocked' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('rm -rf /', {});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should output JSON when --json', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK', details: {} });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('cmd', { json: true });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try { const p = JSON.parse(c[0]); return p.command !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeTruthy();
    });
  });

  describe('--level', () => {
    it('should print risk level', async () => {
      mockGetRisk.mockReturnValue('low');
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('safe-cmd', { level: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('low'));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit 1 for high risk', async () => {
      mockGetRisk.mockReturnValue('high');
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('rm -rf /', { level: true });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should output JSON when --json', async () => {
      mockGetRisk.mockReturnValue('medium');
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'OK' });
      mockCreateGate.mockReturnValue({ check: mockCheck } as any);

      await executeCommand('cmd', { level: true, json: true });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try { const p = JSON.parse(c[0]); return p.level !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeTruthy();
    });
  });
});
