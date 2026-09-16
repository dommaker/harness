/**
 * performance 命令测试
 */

import { performance } from '../performance';
import { captureIO, type CapturingIO } from '../../command-contract';
import { decide, fakeGate, throwingGate } from './gate-decision';
import { PerformanceGate } from '../../../gates/performance';

jest.mock('../../../gates/performance', () => ({
  PerformanceGate: jest.fn().mockImplementation(() => ({
    evaluate: jest.fn(),
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
    MockGate.mockImplementation(() =>
      fakeGate(
        decide('performance', true, 'ok', {
          metrics: { coverage: 85.5, bundleSize: 204800 },
        })
      ) as any
    );

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查通过');
    expect(result.kind).toBe('ok');
  });

  it('should print failure and exit 1 when check fails', async () => {
    MockGate.mockImplementation(() =>
      fakeGate(
        decide('performance', false, 'threshold exceeded', {
          failures: ['coverage below 80%', 'bundle too large'],
        })
      ) as any
    );

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查失败');
    expect(result).toEqual({
      kind: 'fail',
      reason: 'performance gate denied: threshold exceeded',
    });
  });

  it('should handle errors and exit 1', async () => {
    MockGate.mockImplementation(() => throwingGate(new Error('gate error')) as any);

    const result = await performance({}, io);

    expect(io.outText()).toContain('性能门控检查出错');
    expect(result).toEqual({
      kind: 'fail',
      reason: 'performance gate error: gate error',
    });
  });

  it('bundleThreshold 直传 KB 到 maxBundleSize（不再按字节错位换算）', async () => {
    MockGate.mockImplementation(() => fakeGate(decide('performance', true, 'ok')) as any);

    await performance({ bundleThreshold: 500 }, io);

    expect(MockGate).toHaveBeenCalledWith(
      expect.objectContaining({
        thresholds: expect.objectContaining({ maxBundleSize: 500 }),
      }),
    );
  });

  it('coverage 旗帜对齐 minCoverage 字段（原 coverage 错位键名恒不生效）', async () => {
    MockGate.mockImplementation(() => fakeGate(decide('performance', true, 'ok')) as any);

    await performance({ coverage: true, coverageThreshold: 90 }, io);

    expect(MockGate).toHaveBeenCalledWith(
      expect.objectContaining({
        thresholds: expect.objectContaining({ minCoverage: 90 }),
      }),
    );
  });
});
