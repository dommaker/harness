/**
 * release 命令测试（O6）
 *
 * Seam：release(options) 公开入口。
 * 隔离面：
 *   - child_process.execSync → 按命令分发的 fixture（git/npm/tsc 全部 mock，绝不真执行）
 *   - fs.existsSync / readFileSync → fixture 包（package.json + dist 关键文件）
 *   - process.exit → 抛异常断言化（exit code 可断言，且阻断后续真实副作用）
 *
 * 测试止于 dry-run 与「发布前闸门」（分支/同步/干净树/tag 冲突），
 * 不覆盖真实 npm version/publish 路径——禁止真发版。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { release } from '../release';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const chalkFn = Object.assign(id, {
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  });
  return {
    __esModule: true,
    default: chalkFn,
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  };
});

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockFs = fs as jest.Mocked<typeof fs>;

const PKG_JSON = JSON.stringify({
  name: '@dommaker/harness',
  version: '0.18.0',
  main: './dist/index.js',
  bin: './bin/harness.js',
  exports: { '.': './dist/index.js' },
});

describe('release command', () => {
  let consoleSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;
  let pkgExists: boolean;
  let tagListResult: string;

  beforeEach(() => {
    jest.clearAllMocks();
    pkgExists = true;
    tagListResult = '';
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`__exit_${code}__`);
    });

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return pkgExists;
      return true; // dist 关键文件视为存在
    });
    mockFs.readFileSync.mockReturnValue(PKG_JSON);

    mockExecSync.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.startsWith('git rev-parse --abbrev-ref')) return 'master';
      if (c.startsWith('git rev-list --count')) return '0';
      if (c.startsWith('git status --porcelain')) return '';
      if (c.startsWith('git tag -l')) return tagListResult;
      if (c.startsWith('npx tsc')) return 'build ok';
      return '';
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test('非包目录：exit 1 并提示 Not a package', async () => {
    pkgExists = false;

    await expect(release({})).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Not a package'));
  });

  test('非 master/main 分支：exit 1 并提示', async () => {
    mockExecSync.mockImplementation((cmd: string) =>
      String(cmd).startsWith('git rev-parse --abbrev-ref') ? 'feat/x' : '');

    await expect(release({})).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Must be on master or main branch'));
  });

  test('落后于远程：exit 1 并提示 behind', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.startsWith('git rev-parse --abbrev-ref')) return 'master';
      if (c.startsWith('git rev-list --count')) return '3';
      return '';
    });

    await expect(release({})).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('behind origin'));
  });

  test('工作树不干净：exit 1 并提示 Uncommitted changes', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.startsWith('git rev-parse --abbrev-ref')) return 'master';
      if (c.startsWith('git rev-list --count')) return '0';
      if (c.startsWith('git status --porcelain')) return ' M package.json';
      return '';
    });

    await expect(release({})).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Uncommitted changes'));
  });

  test('dist 关键发布物缺失：发布前闸门 exit 1（不触 npm version）', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return true;
      if (String(p).includes(`${path.sep}dist${path.sep}`)) return false;
      return true;
    });

    await expect(release({ bumpType: 'patch' })).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dist missing critical artifacts'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dist/index.js'));
    const commands = mockExecSync.mock.calls.map(c => String(c[0]));
    expect(commands.some(c => c.startsWith('npm version'))).toBe(false);
  });

  test('dry-run patch：计算目标版本 0.18.1，exit 0', async () => {
    await expect(release({ bumpType: 'patch', dryRun: 'true' })).rejects.toThrow('__exit_0__');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dry-run complete. Would publish: @dommaker/harness@0.18.1'),
    );
  });

  test('dry-run minor：计算目标版本 0.19.0', async () => {
    await expect(release({ bumpType: 'minor', dryRun: 'true' })).rejects.toThrow('__exit_0__');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dry-run complete. Would publish: @dommaker/harness@0.19.0'),
    );
  });

  test('目标 tag 已存在：发布前闸门 exit 1（不触 npm version）', async () => {
    tagListResult = 'v0.18.1';

    await expect(release({ bumpType: 'patch' })).rejects.toThrow('__exit_1__');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    // 闸门阻断：npm version / npm publish 从未执行
    const commands = mockExecSync.mock.calls.map(c => String(c[0]));
    expect(commands.some(c => c.startsWith('npm version'))).toBe(false);
    expect(commands.some(c => c.startsWith('npm publish'))).toBe(false);
  });
});
