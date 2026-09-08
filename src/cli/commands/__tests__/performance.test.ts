/**
 * performance 命令测试
 */

import { performance } from '../performance';
import { captureIO, type CapturingIO } from '../../command-contract';
import { PerformanceGate } from '../../../gates/performance';

jest.mock('../../../gates/performance', () => ({
  PerformanceGate: jest.fn().mockImplementation(() => ({
    check: jest.fn(),
  })),
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

const MockGate = PerformanceGate as jest.MockedClass<typeof PerformanceGate>;

describe('performance command', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  it('should print success when check passes', async () => {
    const mockCheck = jest.fn().mockResolvedValue({
      passed: true,
      message: 'ok',
      details: {
        metrics: { coverage: 85.5, bundleSize: 204800, benchmarkTime: 150 },
      },
    });
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查通过');
    expect(result.kind).toBe('ok');
  });

  it('should print failure and exit 1 when check fails', async () => {
    const mockCheck = jest.fn().mockResolvedValue({
      passed: false,
      message: 'threshold exceeded',
      details: { failures: ['coverage below 80%', 'bundle too large'] },
    });
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查失败');
    expect(result).toEqual({
      kind: 'fail',
      reason: 'performance gate denied: threshold exceeded',
    });
  });

  it('should handle errors and exit 1', async () => {
    const mockCheck = jest.fn().mockRejectedValue(new Error('gate error'));
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查出错');
    expect(result).toEqual({
      kind: 'fail',
      reason: 'performance gate error: gate error',
    });
  });

  it('should convert bundleThreshold from KB to bytes', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    await performance({ bundleThreshold: 500 }, io);

    expect(MockGate).toHaveBeenCalledWith(
      expect.objectContaining({
        thresholds: expect.objectContaining({ bundleSize: 500 * 1024 }),
      }),
    );
  });

  it('should convert benchmarkTimeout from seconds to ms', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    await performance({ benchmarkTimeout: 30 }, io);

    expect(MockGate).toHaveBeenCalledWith(
      expect.objectContaining({ benchmarkTimeout: 30000 }),
    );
  });

  it('should set coverage threshold when both flags provided', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
    MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

    await performance({ coverage: true, coverageThreshold: 90 }, io);

    expect(MockGate).toHaveBeenCalledWith(
      expect.objectContaining({
        thresholds: expect.objectContaining({ coverage: 90 }),
      }),
    );
  });
});
