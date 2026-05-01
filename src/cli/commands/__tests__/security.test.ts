/**
 * security 命令测试
 */

import { security, auditDetails } from '../security';
import { SecurityGate } from '../../../gates/security';

jest.mock('../../../gates/security', () => ({
  SecurityGate: jest.fn().mockImplementation(() => ({
    scan: jest.fn(),
  })),
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: Object.assign(jest.fn((s: string) => s), { bold: jest.fn((s: string) => s) }),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

const MockGate = SecurityGate as jest.MockedClass<typeof SecurityGate>;

describe('security command', () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('security', () => {
    it('should print success when scan passes', async () => {
      const mockScan = jest.fn().mockResolvedValue({
        passed: true,
        message: 'no vulnerabilities',
        details: { critical: 0, high: 0, moderate: 0, low: 0 },
      });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('安全门控检查通过'));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should print failure and exit 1 when scan fails', async () => {
      const mockScan = jest.fn().mockResolvedValue({
        passed: false,
        message: 'vulnerabilities found',
        details: {
          critical: 1,
          high: 2,
          vulnerabilities: [
            { name: 'pkg-a', severity: 'critical', via: 'CVE-2026-0001' },
            { name: 'pkg-b', severity: 'high', via: 'CVE-2026-0002' },
          ],
        },
      });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('安全门控检查失败'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pkg-a'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pkg-b'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should default severity to high', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({});

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'high' }),
      );
    });

    it('should use custom severity', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({ severity: 'critical' });

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'critical' }),
      );
    });
  });

  describe('auditDetails', () => {
    it('should print no vulnerabilities when passed with no total', async () => {
      const mockScan = jest.fn().mockResolvedValue({
        passed: true,
        message: 'ok',
        details: {},
      });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await auditDetails({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未发现安全漏洞'));
    });

    it('should list vulnerabilities when present', async () => {
      const mockScan = jest.fn().mockResolvedValue({
        passed: false,
        message: 'vulns found',
        details: {
          total: 2,
          vulnerabilities: [
            { name: 'pkg-a', severity: 'high', via: 'CVE-2026-0001' },
            { name: 'pkg-b', severity: 'low', via: 'CVE-2026-0002' },
          ],
        },
      });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await auditDetails({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('发现 2 个漏洞'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pkg-a'));
    });

    it('should default severity to low for audit', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok', details: {} });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await auditDetails({});

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'low' }),
      );
    });
  });
});
