/**
 * D4：SecurityGate 默认审计 registry 固定
 *
 * 默认扫描命令（detectScanCommand 第三级）必须固定可信 registry
 * https://registry.npmjs.org/——npm 的命令行 `--registry` 旗标优先于项目
 * .npmrc 的 registry 配置，项目 npm 配置不能改变默认审计来源。
 *
 * 显式可信输入（context.securityScanCommand / 构造器 scanCommand）保持
 * 原样下发，不偷偷追加 registry。
 *
 * 替身落点：`src/utils/exec` 的 execAsync 缝（记录实际下发执行的命令字符串），
 * .npmrc 用每轮唯一 mkdtemp 夹具真实落盘。缺省链可达性见 security-default-scan.test.ts。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import { SecurityGate } from '../security';

jest.mock('../../utils/exec', () => {
  const actual = jest.requireActual('../../utils/exec');
  return { ...actual, execAsync: jest.fn() };
});

const mockExecAsync = execAsync as unknown as jest.Mock;

/** D4 钉死的默认审计命令（含可信 registry 旗标） */
const PINNED = 'npm audit --json --registry https://registry.npmjs.org/';

describe('SecurityGate 默认审计 registry 固定（D4）', () => {
  /** 门禁本轮实际下发执行的命令（按调用顺序） */
  const issued = (): string[] => mockExecAsync.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({
      stdout: JSON.stringify({ vulnerabilities: {} }),
      stderr: '',
    });
  });

  it('项目 .npmrc 指向其他 registry 时，默认审计仍固定官方 registry', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-npmrc-'));
    try {
      fs.writeFileSync(
        path.join(project, '.npmrc'),
        'registry=https://registry.example.invalid/\n',
      );

      const result = await new SecurityGate().scan({ projectPath: project });

      expect(issued()).toEqual([PINNED]);
      expect(result.details?.scanCommand).toBe(PINNED);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('项目 .npmrc 配置 scope registry 也不能改变默认审计来源', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-npmrc-scope-'));
    try {
      fs.writeFileSync(
        path.join(project, '.npmrc'),
        '@corp:registry=https://npm.corp.example.invalid/\n',
      );

      await new SecurityGate().scan({ projectPath: project });

      expect(issued()).toEqual([PINNED]);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it('context.securityScanCommand 显式可信输入原样下发，不追加 registry', async () => {
    await new SecurityGate().scan({
      projectPath: '/test/project',
      securityScanCommand: 'snyk test --json',
    });

    expect(issued()).toEqual(['snyk test --json']);
    expect(issued()[0]).not.toContain('--registry');
  });

  it('构造器 scanCommand 显式可信输入原样下发，不追加 registry', async () => {
    await new SecurityGate({ scanCommand: 'pnpm audit --json' }).scan({
      projectPath: '/test/project',
    });

    expect(issued()).toEqual(['pnpm audit --json']);
    expect(issued()[0]).not.toContain('--registry');
  });
});
