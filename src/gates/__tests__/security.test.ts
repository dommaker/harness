/**
 * SecurityGate 测试
 */

import { SecurityGate } from '../security';
import { exec } from 'child_process';

// Mock exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

describe('SecurityGate', () => {
  let gate: SecurityGate;
  const baseContext = {
    projectId: 'test-project',
    projectPath: '/test/project',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gate = new SecurityGate();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const defaultGate = new SecurityGate();
      const config = defaultGate.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.severityThreshold).toBe('high');
      expect(config.ignoreWarnings).toBe(false);
      expect(config.ignoreDevDependencies).toBe(false);
    });

    it('should accept custom config', () => {
      const customGate = new SecurityGate({
        enabled: false,
        severityThreshold: 'critical',
        ignoreWarnings: true,
      });
      const config = customGate.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.severityThreshold).toBe('critical');
      expect(config.ignoreWarnings).toBe(true);
    });
  });

  describe('scan()', () => {
    it('should pass when gate is disabled', async () => {
      const disabledGate = new SecurityGate({ enabled: false });

      const result = await disabledGate.scan(baseContext);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('已禁用');
    });

    it('should pass when no vulnerabilities found', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: JSON.stringify({ vulnerabilities: {} }) });
      });

      const result = await gate.scan(baseContext);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('通过');
    });

    it('should fail when critical vulnerabilities found', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(
          { stdout: JSON.stringify({ vulnerabilities: { lodash: { severity: 'critical' } } }) },
          null
        );
      });

      const result = await gate.scan(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('严重漏洞');
    });

    it('should fail when high vulnerabilities found (default threshold)', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(
          { stdout: JSON.stringify({ vulnerabilities: { axios: { severity: 'high' } } }) },
          null
        );
      });

      const result = await gate.scan(baseContext);

      expect(result.passed).toBe(false);
      expect(result.details?.high).toBe(1);
    });

    it('should pass with high threshold when only moderate found', async () => {
      const strictGate = new SecurityGate({ severityThreshold: 'high' });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: JSON.stringify({ vulnerabilities: { pkg: { severity: 'moderate' } } }) });
      });

      const result = await strictGate.scan(baseContext);

      expect(result.passed).toBe(true);
    });

    it('should fail with low threshold when any vulnerability found', async () => {
      const strictGate = new SecurityGate({ severityThreshold: 'low' });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: JSON.stringify({ vulnerabilities: { pkg: { severity: 'low' } } }) });
      });

      const result = await strictGate.scan(baseContext);

      expect(result.passed).toBe(false);
    });

    it('should use custom scan command from context', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        expect(cmd).toContain('yarn audit');
        callback(null, { stdout: JSON.stringify({ vulnerabilities: {} }) });
      });

      await gate.scan({
        ...baseContext,
        securityScanCommand: 'yarn audit --json',
      });
    });

    it('should use custom scan command from config', async () => {
      const customGate = new SecurityGate({
        scanCommand: 'pnpm audit --json',
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        expect(cmd).toContain('pnpm audit');
        callback(null, { stdout: JSON.stringify({ vulnerabilities: {} }) });
      });

      await customGate.scan(baseContext);
    });

    it('should handle exec error without stdout', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Command failed'), null);
      });

      const result = await gate.scan(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('失败');
    });

    it('should return top 10 vulnerabilities', async () => {
      // Create 15 vulnerabilities
      const vulns: Record<string, any> = {};
      for (let i = 0; i < 15; i++) {
        vulns[`pkg-${i}`] = { severity: 'high', name: `pkg-${i}` };
      }

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback({ stdout: JSON.stringify({ vulnerabilities: vulns }) }, null);
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.vulnerabilities?.length).toBeLessThanOrEqual(10);
    });
  });

  describe('analyzeResult() - npm audit format', () => {
    it('should parse audit.advisories format', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            audit: {
              advisories: {
                '123': {
                  name: 'lodash',
                  severity: 'high',
                  title: 'Prototype Pollution',
                },
              },
            },
          }),
        });
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.high).toBe(1);
    });

    it('should parse vulnerabilities format (new npm audit)', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(
          {
            stdout: JSON.stringify({
              vulnerabilities: {
                axios: {
                  severity: 'critical',
                  via: [{ title: 'SSRF' }],
                },
              },
            }),
          },
          null
        );
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.critical).toBe(1);
    });

    it('should count all severity levels', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(
          {
            stdout: JSON.stringify({
              vulnerabilities: {
                pkg1: { severity: 'critical' },
                pkg2: { severity: 'high' },
                pkg3: { severity: 'moderate' },
                pkg4: { severity: 'low' },
                pkg5: { severity: 'info' },
              },
            }),
          },
          null
        );
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.critical).toBe(1);
      expect(result.details?.high).toBe(1);
      expect(result.details?.moderate).toBe(1);
      expect(result.details?.low).toBe(2); // low + info
      expect(result.details?.total).toBe(5);
    });
  });

  describe('analyzeResult() - text fallback', () => {
    it('should parse text output when JSON fails', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: 'found 2 critical, 3 high, 4 moderate, 5 low vulnerabilities',
        });
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.critical).toBe(2);
      expect(result.details?.high).toBe(3);
      expect(result.details?.moderate).toBe(4);
      expect(result.details?.low).toBe(5);
    });

    it('should handle missing severity in text', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: 'no vulnerabilities found' });
      });

      const result = await gate.scan(baseContext);

      expect(result.details?.total).toBe(0);
    });
  });

  describe('setSeverityThreshold()', () => {
    it('should update threshold', () => {
      gate.setSeverityThreshold('moderate');
      const config = gate.getConfig();
      expect(config.severityThreshold).toBe('moderate');
    });

    it('should affect scan result', async () => {
      gate.setSeverityThreshold('moderate');

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(
          { stdout: JSON.stringify({ vulnerabilities: { pkg: { severity: 'moderate' } } }) },
          null
        );
      });

      const result = await gate.scan(baseContext);

      expect(result.passed).toBe(false);
    });
  });

  describe('getConfig()', () => {
    it('should return copy of config', () => {
      const config1 = gate.getConfig();
      const config2 = gate.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });

  describe('timing', () => {
    it('should include duration in result', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        setTimeout(() => {
          callback(null, { stdout: JSON.stringify({ vulnerabilities: {} }) });
        }, 50);
      });

      const result = await gate.scan(baseContext);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: JSON.stringify({ vulnerabilities: {} }) });
      });

      const result = await gate.scan(baseContext);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });
});
