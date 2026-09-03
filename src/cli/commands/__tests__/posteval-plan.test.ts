/**
 * posteval-plan 命令测试
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as path from 'path';

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('postevalPlan', () => {
  jest.setTimeout(30000); // Retry-based tests with exponential backoff need longer timeout
  const tempDir = path.join(process.cwd(), 'temp-test-posteval');
  const planPath = path.join(tempDir, 'plan.md');
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(planPath, '# Test plan\n- [AC-001] Task 1\n- [AC-002] Task 2');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    delete process.env.API_PORT;
    delete process.env.POSTEVAL_GRACE_MS;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.useRealTimers();
  });

  it('应该成功验证 plan 覆盖率并打印绿色信息', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 1,
        matchedAcs: ['AC-001', 'AC-002'],
        missedAcs: [],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath }, io);

    expect(io.outText()).toContain('100%');
  });

  it('completeness < 1：fail（覆盖率不足，含缺失项）', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 0.5,
        matchedAcs: ['AC-001'],
        missedAcs: ['AC-002'],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({ kind: 'fail', reason: expect.stringContaining('plan coverage 50% < 100%') });
    expect(io.errText()).toContain('50%');
  });

  it('completeness < 1 时应该列出缺失项', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 0.33,
        matchedAcs: ['AC-001'],
        missedAcs: ['AC-002', 'AC-003'],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({
      kind: 'fail',
      reason: 'plan coverage 33% < 100%，缺 2 项: AC-002; AC-003',
    });
    expect(io.errText()).toContain('AC-002');
  });

  it('4xx 错误应该 exit(1)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({ kind: 'fail', reason: 'PostEval API error: 400 Bad Request' });
    expect(io.errText()).toContain('400');
  });

  it('5xx 错误：skip（未判定，允许提交；退出码面 0 不变）', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({ kind: 'skip', reason: expect.stringContaining('服务端错误 503') });
    expect(io.errText()).toContain('unavailable');
  });

  it('网络错误重试耗尽：skip（未判定，允许提交）', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({ kind: 'skip', reason: expect.stringContaining('Studio API 不可达') });
    expect(io.errText()).toContain('unreachable');
  });

  it('应该支持自定义 API_PORT', async () => {
    process.env.API_PORT = '3999';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 1,
        matchedAcs: ['AC-001'],
        missedAcs: [],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath }, io);

    // Verify the fetch was called with port 3999
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(fetchCall).toContain(':3999');
  });

  it('网络错误重试后成功应该不退出', async () => {
    // First 2 calls fail, 3rd succeeds
    const mockFetch = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          completeness: 1,
          matchedAcs: ['AC-001'],
          missedAcs: [],
        }),
      });

    global.fetch = mockFetch as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    // Should have been called 3 times
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(io.outText()).toContain('100%');
    expect(result.kind).toBe('ok');
  });

  it('completeness 为 0 时应该正确显示 0%', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 0,
        matchedAcs: [],
        missedAcs: ['AC-001'],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    const result = await postevalPlan({ planPath }, io);

    expect(result).toEqual({
      kind: 'fail',
      reason: 'plan coverage 0% < 100%，缺 1 项: AC-001',
    });
    expect(io.errText()).toContain('0%');
  });
});
