/**
 * security 命令测试
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { security, auditDetails, secretsScan } from '../security';
import { captureIO, type CapturingIO } from '../../command-contract';
import { decide, fakeGate } from './gate-decision';
import { SecurityGate } from '../../../gates/security';

jest.mock('../../../gates/security', () => ({
  SecurityGate: jest.fn().mockImplementation(() => ({
    evaluate: jest.fn(),
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
      MockGate.mockImplementation(() =>
        fakeGate(decide('security', true, 'no vulnerabilities', { critical: 0, high: 0, moderate: 0, low: 0 })) as any
      );

      const result = await security({}, io);

      expect(io.outText()).toContain('安全门控检查通过');
      expect(result.kind).toBe('ok');
    });

    it('should print failure and exit 1 when scan fails', async () => {
      MockGate.mockImplementation(() =>
        fakeGate(
          decide('security', false, 'vulnerabilities found', {
            critical: 1,
            high: 2,
            vulnerabilities: [
              { name: 'pkg-a', severity: 'critical', via: 'CVE-2026-0001' },
              { name: 'pkg-b', severity: 'high', via: 'CVE-2026-0002' },
            ],
          })
        ) as any
      );

      const result = await security({}, io);

      expect(io.outText()).toContain('安全门控检查失败');
      expect(io.outText()).toContain('   阈值: high');
      expect(io.outText()).toContain('pkg-a');
      expect(io.outText()).toContain('pkg-b');
      expect(result).toEqual({
        kind: 'fail',
        reason: 'security gate denied: vulnerabilities found',
      });
    });

    it('should default severity to high', async () => {
      MockGate.mockImplementation(() => fakeGate(decide('security', true, 'ok')) as any);

      await security({}, io);

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ severityThreshold: 'high' }),
      );
    });

    it('should use custom severity', async () => {
      MockGate.mockImplementation(() => fakeGate(decide('security', true, 'ok')) as any);

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

  describe('secretsScan（P1-8：gitleaks 全历史机密扫描）', () => {
    let repoRoot: string;

    beforeEach(() => {
      repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-secrets-repo-'));
    });

    /**
     * 假执行器（测试不依赖真 gitleaks 二进制）：按 exitCode 抛错，
     * 需要时把 report/rawReport 落到命令行里解析出的 --report-path。
     */
    function fakeExec(behavior: { exitCode: number; report?: unknown; rawReport?: string }) {
      return (async (cmd: string) => {
        const reportPath = cmd.match(/--report-path "([^"]+)"/)![1];
        if (behavior.rawReport !== undefined) {
          fs.writeFileSync(reportPath, behavior.rawReport);
        } else if (behavior.report !== undefined) {
          fs.writeFileSync(reportPath, JSON.stringify(behavior.report));
        }
        if (behavior.exitCode !== 0) {
          throw Object.assign(new Error(`exit ${behavior.exitCode}`), { code: behavior.exitCode });
        }
        return { stdout: '', stderr: '' };
      }) as any;
    }

    it('干净（exit 0 + 空报告）→ ok', async () => {
      const result = await secretsScan({ projectPath: repoRoot }, io, fakeExec({ exitCode: 0, report: [] }));

      expect(result).toEqual({ kind: 'ok' });
      expect(io.outText()).toContain('未发现泄露');
    });

    it('有泄露（exit 1 + 报告有条目）→ fail：列条数与文件，不打印密钥原文', async () => {
      // 假密钥值含 fake 占位标记：no_hardcoded_credentials checker 对 placeholder 行豁免
      const report = [
        { File: 'config/app.yml', RuleID: 'aws-access-key', Secret: 'fake-leak-value-1', Match: 'fake-leak-value-1' },
        { File: 'config/app.yml', RuleID: 'aws-access-key', Secret: 'fake-leak-value-2', Match: 'fake-leak-value-2' },
        { File: 'scripts/deploy.sh', RuleID: 'generic-api-key', Secret: 'fake-token-value-3', Match: 'fake-token-value-3' },
      ];

      const result = await secretsScan({ projectPath: repoRoot }, io, fakeExec({ exitCode: 1, report }));

      expect(result.kind).toBe('fail');
      expect(result.kind === 'fail' && result.reason).toContain('3 potential leaks in 2 files');
      expect(io.outText()).toContain('发现 3 处疑似机密泄露');
      expect(io.outText()).toContain('config/app.yml');
      expect(io.outText()).toContain('scripts/deploy.sh');
      // 密钥原文（Secret/Match 字段）不进输出
      expect(io.outText()).not.toContain('fake-leak-value');
      expect(io.outText()).not.toContain('fake-token-value');
    });

    it('gitleaks 二进制缺失（exit 127）→ skip 并提示安装，不 fail', async () => {
      const result = await secretsScan({ projectPath: repoRoot }, io, fakeExec({ exitCode: 127 }));

      expect(result.kind).toBe('skip');
      expect(result.kind === 'skip' && result.reason).toContain('gitleaks binary not found');
      expect(io.outText()).toContain('跳过全历史机密扫描');
    });

    it('gitleaks 异常退出（非 0/1/127）→ fail（scan error）', async () => {
      const result = await secretsScan({ projectPath: repoRoot }, io, fakeExec({ exitCode: 2 }));

      expect(result).toEqual({ kind: 'fail', reason: 'secrets scan error: gitleaks exited 2' });
    });

    it('报告 JSON 损坏 → fail（report parse failed）', async () => {
      const result = await secretsScan(
        { projectPath: repoRoot },
        io,
        fakeExec({ exitCode: 1, rawReport: 'not json {{{' }),
      );

      expect(result.kind).toBe('fail');
      expect(result.kind === 'fail' && result.reason).toContain('report parse failed');
    });

    it('exit 0 且报告文件未落盘 → 按干净处理（ok）', async () => {
      const result = await secretsScan({ projectPath: repoRoot }, io, fakeExec({ exitCode: 0 }));

      expect(result).toEqual({ kind: 'ok' });
    });
  });
});
