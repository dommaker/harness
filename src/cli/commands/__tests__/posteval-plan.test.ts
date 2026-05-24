/**
 * posteval-plan 命令测试
 */

import * as fs from 'fs';
import * as path from 'path';

describe('postevalPlan', () => {
  jest.setTimeout(30000); // Retry-based tests with exponential backoff need longer timeout
  const tempDir = path.join(process.cwd(), 'temp-test-posteval');
  const planPath = path.join(tempDir, 'plan.md');
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let mockExit: jest.SpyInstance;
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
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Don't actually exit
    }) as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    mockExit.mockRestore();
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
    await postevalPlan({ planPath });

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('100%'));
  });

  it('completeness < 1 应该 exit(1)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        completeness: 0.5,
        matchedAcs: ['AC-001'],
        missedAcs: ['AC-002'],
      }),
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('50%'));
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
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('AC-002'));
  });

  it('4xx 错误应该 exit(1)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('400'));
  });

  it('5xx 错误应该 exit(0) 允许提交', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }) as any;

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });

  it('网络错误重试耗尽后应该 exit(0)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const { postevalPlan } = await import('../posteval-plan');
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
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
    await postevalPlan({ planPath });

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
    await postevalPlan({ planPath });

    // Should have been called 3 times
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('100%'));
    expect(mockExit).not.toHaveBeenCalled();
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
    await postevalPlan({ planPath });

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('0%'));
  });
});
