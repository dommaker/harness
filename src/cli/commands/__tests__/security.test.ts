/**
 * security 命令测试
 */

import { security, auditDetails } from '../security';
import { captureIO, type CapturingIO } from '../../command-contract';
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
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  describe('security', () => {
    it('should print success when scan passes', async () => {
      const mockScan = jest.fn().mockResolvedValue({
        passed: true,
        message: 'no vulnerabilities',
        details: { critical: 0, high: 0, moderate: 0, low: 0 },
      });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      const result = await security({}, io);

      expect(io.outText()).toContain('安全门控检查通过');
      expect(result.kind).toBe('ok');
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

      const result = await security({}, io);

      expect(io.outText()).toContain('安全门控检查失败');
      expect(io.outText()).toContain('pkg-a');
      expect(io.outText()).toContain('pkg-b');
      expect(result).toEqual({
        kind: 'fail',
        reason: 'security gate denied (threshold high): vulnerabilities found',
      });
    });

    it('should default severity to high', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({}, io);

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'high' }),
      );
    });

    it('should use custom severity', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await security({ severity: 'critical' }, io);

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

      await auditDetails({}, io);

      expect(io.outText()).toContain('未发现安全漏洞');
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

      await auditDetails({}, io);

      expect(io.outText()).toContain('发现 2 个漏洞');
      expect(io.outText()).toContain('pkg-a');
    });

    it('should default severity to low for audit', async () => {
      const mockScan = jest.fn().mockResolvedValue({ passed: true, message: 'ok', details: {} });
      MockGate.mockImplementation(() => ({ scan: mockScan }) as any);

      await auditDetails({}, io);

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'low' }),
      );
    });
  });
});
