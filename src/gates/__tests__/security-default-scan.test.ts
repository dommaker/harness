/**
 * #138 缺省扫描命令断链回归测试
 *
 * 断点：SecurityGate 构造器曾把缺省 scanCommand 兜成空串，判定链用 `??`
 * （空串非 nullish），三级兜底恒停在第二级 → runScan('') 抛
 * 「The argument 'file' cannot be empty」，detectScanCommand() 全仓不可达。
 *
 * 替身落点：这里【不 mock 整个 child_process】——那正是缺省路径一直亮绿灯的机制
 * （`security.test.ts` 顶层 jest.mock('child_process') 后，exec('') 照样回调桩数据、
 * 永不抛错，把断点盖住了）。改用 exec 的唯一出口 `src/utils/exec` 的 `execAsync` 作缝：
 * 记录门禁「实际下发去执行的那条命令字符串」，据此断言链真的落到第三级
 * （detectScanCommand 的返回值），并对空串复现真实的 exec 抛错（保持红/绿的分界诚实）。
 * CLI 命令级的缺省路径覆盖见 `src/cli/commands/__tests__/security-default-scan.test.ts`。
 */

import { execAsync } from '../../utils/exec';
import { SecurityGate } from '../security';

// 缝替身：只替换 execAsync，模块其余导出保持真实
jest.mock('../../utils/exec', () => {
  const actual = jest.requireActual('../../utils/exec');
  return { ...actual, execAsync: jest.fn() };
});

const mockExecAsync = execAsync as unknown as jest.Mock;

/** detectScanCommand() 现返回值——链落到第三级的唯一判据 */
const DETECTED = 'npm audit --json';
const projectPath = '/probe/project';

describe('SecurityGate 缺省扫描命令（#138 断链）', () => {
  /** 门禁本轮实际下发执行的命令（按调用顺序） */
  const issued = (): string[] => mockExecAsync.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    jest.clearAllMocks();
    // 缝替身：空命令复现真实 exec 抛错；非空则回零漏洞 JSON（判定为通过）
    mockExecAsync.mockImplementation((cmd: string) => {
      if (!cmd || !cmd.trim()) {
        return Promise.reject(
          new TypeError("The argument 'file' cannot be empty. Received ''")
        );
      }
      return Promise.resolve({ stdout: JSON.stringify({ vulnerabilities: {} }), stderr: '' });
    });
  });

  describe('三级兜底链可达性', () => {
    it('不给任何扫描命令 → 下发的是 detectScanCommand() 的返回值而非空串', async () => {
      const result = await new SecurityGate().scan({ projectPath });

      expect(issued()).toEqual([DETECTED]); // 链走到第三级并把它交给 exec
      expect(result.details?.scanCommand).toBe(DETECTED);
      expect(result.passed).toBe(true);
    });

    it('evaluate() 缺省路径 → abstain 判定，不再报错（harness security 复现路径）', async () => {
      const decision = await new SecurityGate().evaluate({ projectPath });

      expect(issued()).toEqual([DETECTED]);
      expect(decision.status).toBe('abstain');
    });

    it('context.securityScanCommand 优先级最高，不触达探测', async () => {
      const result = await new SecurityGate().scan({
        projectPath,
        securityScanCommand: 'yarn audit --json',
      });

      expect(issued()).toEqual(['yarn audit --json']);
      expect(result.details?.scanCommand).toBe('yarn audit --json');
    });

    it('构造时显式 scanCommand 优先于探测，不触达第三级', async () => {
      const result = await new SecurityGate({ scanCommand: 'pnpm audit --json' }).scan({
        projectPath,
      });

      expect(issued()).toEqual(['pnpm audit --json']);
      expect(result.details?.scanCommand).toBe('pnpm audit --json');
    });
  });

  describe('空串归一（--scan-command ""）', () => {
    it('显式空串视为未提供 → 归一为 undefined 并落到探测', async () => {
      const result = await new SecurityGate({ scanCommand: '' }).scan({ projectPath });

      expect(issued()).toEqual([DETECTED]);
      expect(result.details?.scanCommand).toBe(DETECTED);
    });

    it('构造器不再出现 scanCommand 的空串缺省', () => {
      expect(new SecurityGate().getConfig().scanCommand).toBeUndefined();
      expect(new SecurityGate({ scanCommand: '' }).getConfig().scanCommand).toBeUndefined();
    });
  });
});
