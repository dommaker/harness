/**
 * #138 缺省扫描命令断链回归测试（CLI 命令级）
 *
 * 门禁级的三级兜底可达性见 `src/gates/__tests__/security-default-scan.test.ts`。
 * 本文件从命令入口证明：不给 --scan-command 时，`harness security` / `harness security audit`
 * 走的正是恢复后的缺省链——把 detectScanCommand() 的返回值交给执行，不再以空串报错退出。
 *
 * 替身只落在 `src/utils/exec` 的 execAsync 缝上（记录命令 + 对空串复现真实抛错），
 * 门禁与命令实现全部走真码；chalk 桩掉只为读输出，成败按 CommandResult.kind 判定。
 */

import { execAsync } from '../../../utils/exec';
import { security, auditDetails } from '../security';
import { captureIO, type CapturingIO } from '../../command-contract';

jest.mock('../../../utils/exec', () => {
  const actual = jest.requireActual('../../../utils/exec');
  return { ...actual, execAsync: jest.fn() };
});

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: Object.assign(jest.fn((s: string) => s), { bold: jest.fn((s: string) => s) }),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

const mockExecAsync = execAsync as unknown as jest.Mock;
const DETECTED = 'npm audit --json';

describe('harness security 缺省扫描命令（#138 断链 · CLI 级）', () => {
  const issued = (): string[] => mockExecAsync.mock.calls.map((c) => String(c[0]));
  let io: CapturingIO;

  beforeEach(() => {
    jest.clearAllMocks();
    io = captureIO();
    mockExecAsync.mockImplementation((cmd: string) => {
      if (!cmd || !cmd.trim()) {
        return Promise.reject(new TypeError("The argument 'file' cannot be empty. Received ''"));
      }
      return Promise.resolve({ stdout: JSON.stringify({ vulnerabilities: {} }), stderr: '' });
    });
  });

  it('security 不给 --scan-command → 执行探测命令并按结果放行', async () => {
    const result = await security({}, io);

    expect(issued()).toEqual([DETECTED]);
    expect(result.kind).toBe('ok');
  });

  it('security audit 不给 --scan-command → 同一条链真的把扫描命令交给执行', async () => {
    const result = await auditDetails({}, io);

    expect(issued()).toEqual([DETECTED]);
    expect(result.kind).toBe('ok');
    expect(io.outText()).toContain('未发现安全漏洞');
  });

  it('security --scan-command "" → 视为未提供，落到探测', async () => {
    const result = await security({ scanCommand: '' }, io);

    expect(issued()).toEqual([DETECTED]);
    expect(result.kind).toBe('ok');
  });

  it('security --scan-command <cmd> 显式路径行为不变', async () => {
    const result = await security({ scanCommand: 'snyk test --json' }, io);

    expect(issued()).toEqual(['snyk test --json']);
    expect(result.kind).toBe('ok');
  });
});
