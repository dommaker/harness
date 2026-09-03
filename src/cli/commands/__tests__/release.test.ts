/**
 * release 命令测试（O6 + 架构评审候选7）
 *
 * Seam：release(options, io) 公开入口。
 * 隔离面：
 *   - child_process.execSync → 按命令前缀分发的 fixture（git/npm/tsc 全部 mock，绝不真执行）
 *   - fs.existsSync / readFileSync → fixture 包（package.json + dist 关键文件）
 *   - 输出 → 注入 captureIO（不再 spyOn(process,'exit') / 断言彩色字符串）
 *
 * 判定结果经返回值外溢：每个前置闸门的失败原因含闸门标识（gate <id>），
 * 测试断言 kind + reason + 「首败即停」（后续闸门副作用未发生）。
 *
 * 测试止于 dry-run 与「发布前闸门」，不覆盖真实 npm version/publish 路径——禁止真发版。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { captureIO, type CapturingIO } from '../../../cli/command-contract';
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

/** 抛一个带 stderr 的子进程失败（execSync 失败对象的形状） */
function fail(cmd: string, stderr = cmd): never {
  const err: any = new Error(`${cmd} exited`);
  err.stderr = stderr;
  throw err;
}

type Override = [prefix: string, handler: (cmd: string) => string];

/**
 * 全闸门通过的默认流（master / 已同步 / 干净树 / tsc ok / dist ok /
 * npm version → v0.18.1 / npm view → 0.18.1），overrides 按前缀优先命中。
 */
function flow(overrides: Override[] = []): void {
  mockExecSync.mockImplementation((cmd) => {
    const c = String(cmd);
    for (const [prefix, handler] of overrides) {
      if (c.startsWith(prefix)) return handler(c);
    }
    if (c.startsWith('git rev-parse --abbrev-ref')) return 'master';
    if (c.startsWith('git rev-list --count')) return '0';
    if (c.startsWith('git status --porcelain')) return '';
    if (c.startsWith('git tag -l')) return '';
    if (c.startsWith('npx tsc')) return 'build ok';
    if (c.startsWith('npm version')) return 'v0.18.1';
    if (c.startsWith('npm view')) return '0.18.1';
    return '';
  });
}

function execCommands(): string[] {
  return mockExecSync.mock.calls.map(c => String(c[0]));
}

/** 断言 fail 结果的 reason 定位到指定闸门 */
function gateFail(gate: string) {
  return { kind: 'fail' as const, reason: expect.stringContaining(`gate ${gate}`) };
}

describe('release command', () => {
  let io: CapturingIO;
  let pkgExists: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    io = captureIO();
    pkgExists = true;

    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return pkgExists;
      return true; // dist 关键文件视为存在
    });
    mockFs.readFileSync.mockReturnValue(PKG_JSON);

    flow();
  });

  test('闸门 1 非包目录：fail 定位 package 闸门，零子进程调用', async () => {
    pkgExists = false;

    const result = await release({}, io);

    expect(result).toEqual(gateFail('package'));
    expect(io.errLines().join('\n')).toContain('Not a package');
    expect(execCommands()).toEqual([]);
  });

  test('闸门 2 非 master/main 分支：fail 定位 branch 闸门，后续闸门不执行', async () => {
    flow([['git rev-parse --abbrev-ref', () => 'feat/x']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('branch'));
    expect(io.errText()).toContain('Must be on master or main branch');
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('git fetch'))).toBe(false);
    expect(commands.some(c => c.startsWith('npx tsc'))).toBe(false);
  });

  test('闸门 3 落后于远程：fail 定位 remote-sync 闸门', async () => {
    flow([['git rev-list --count', () => '3']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('remote-sync'));
    expect(io.errText()).toContain('behind origin');
    expect(execCommands().some(c => c.startsWith('npx tsc'))).toBe(false);
  });

  test('闸门 4 工作树不干净：fail 定位 clean-tree 闸门', async () => {
    flow([['git status --porcelain', () => ' M package.json']]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('clean-tree'));
    expect(io.errText()).toContain('Uncommitted changes');
    expect(execCommands().some(c => c.startsWith('npx tsc'))).toBe(false);
  });

  test('闸门 5 tsc 构建失败：fail 定位 build 闸门', async () => {
    flow([['npx tsc', (c) => fail(c, 'error TS2304: cannot find name')]]);

    const result = await release({}, io);

    expect(result).toEqual(gateFail('build'));
    expect(io.errText()).toContain('tsc failed');
    expect(io.errText()).toContain('TS2304');
  });

  test('闸门 6 dist 关键发布物缺失：fail 定位 dist-artifacts 闸门（不触 npm version）', async () => {
    mockFs.existsSync.mockImplementation((p) => {
      if (String(p).endsWith('package.json')) return true;
      if (String(p).includes(`${path.sep}dist${path.sep}`)) return false;
      return true;
    });

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('dist-artifacts'));
    expect(io.errText()).toContain('dist missing critical artifacts');
    expect(io.errText()).toContain('dist/index.js');
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test.each([
    ['patch', '0.18.1'],
    ['minor', '0.19.0'],
    ['major', '1.0.0'],
  ] as const)('dry-run %s：ok 且提示目标版本 %s（不触 npm version）', async (bumpType, expected) => {
    const result = await release({ bumpType, dryRun: 'true' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain(`Dry-run complete. Would publish: @dommaker/harness@${expected}`);
    expect(execCommands().some(c => c.startsWith('npm version'))).toBe(false);
  });

  test('闸门 7 目标 tag 已存在：fail 定位 tag-conflict 闸门（不触 npm version/publish）', async () => {
    flow([['git tag -l', () => 'v0.18.1']]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('tag-conflict'));
    expect(io.errText()).toContain('already exists');
    const commands = execCommands();
    expect(commands.some(c => c.startsWith('npm version'))).toBe(false);
    expect(commands.some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('闸门 8 npm version 失败：fail 定位 version-bump 闸门（不触 push）', async () => {
    flow([['npm version', (c) => fail(c, 'npm ERR! Version prefix required')]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('version-bump'));
    expect(io.errText()).toContain('npm version failed');
    expect(execCommands().some(c => c.startsWith('git push'))).toBe(false);
  });

  test('闸门 9 git push 失败（非保护分支）：fail 定位 git-push 闸门', async () => {
    flow([['git push origin master', (c) => fail(c, 'error: failed to push some refs')]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('git-push'));
    expect(io.errText()).toContain('git push failed');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('闸门 10 保护分支且 PR 创建失败：fail 定位 pr-create 闸门', async () => {
    flow([
      ['git push origin master', (c) => fail(c, 'GH006: push rejected to protected branch')],
      ['gh pr create', (c) => fail(c, 'could not create pull request')],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('pr-create'));
    expect(io.errText()).toContain('PR creation failed');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('保护分支且 PR 创建成功：ok（不走 npm publish，打印后续步骤）', async () => {
    flow([
      ['git push origin master', (c) => fail(c, 'GH006: push rejected to protected branch')],
      ['gh pr create', () => 'https://github.com/x/y/pull/9'],
    ]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('PR created: https://github.com/x/y/pull/9');
    expect(io.outText()).toContain('Next steps');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('闸门 11 package.json private=true：fail 定位 private-flag 闸门（不触 npm publish）', async () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      name: '@dommaker/harness',
      version: '0.18.0',
      private: true,
      main: './dist/index.js',
    }));

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('private-flag'));
    expect(io.errText()).toContain('"private": true');
    expect(execCommands().some(c => c.startsWith('npm publish'))).toBe(false);
  });

  test('闸门 12 npm 版本校验不一致：fail 定位 npm-publish-verify 闸门', async () => {
    flow([['npm view', () => '0.0.1']]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual(gateFail('npm-publish-verify'));
    expect(io.errText()).toContain('npm publish verification failed');
    expect(io.errText()).toContain('Expected 0.18.1, registry has 0.0.1');
  });

  test('发布全流程通过：ok，GitHub Release 失败为非致命告警', async () => {
    flow([['gh release create', (c) => fail(c, 'gh: could not generate notes')]]);

    const result = await release({ bumpType: 'patch' }, io);

    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('Released @dommaker/harness@0.18.1');
    expect(io.outText()).toContain('release may have failed (non-fatal)');
    expect(io.outText()).toContain('npm: published @dommaker/harness@0.18.1');
  });

  test('闸门标识唯一且覆盖全部前置闸门（失败原因可逐闸门断言）', () => {
    // 本文件 mock 了 fs，读源码要走真实 fs
    const source: string = jest.requireActual('fs').readFileSync(path.join(__dirname, '..', 'release.ts'), 'utf-8');
    expect(source).toContain('export async function release');
    const gateIds = [...source.matchAll(/gateFail\('([a-z0-9-]+)'/g)].map(m => m[1]);
    expect(gateIds.length).toBeGreaterThanOrEqual(12);
    expect(new Set(gateIds).size).toBe(gateIds.length);
    expect(gateIds).toEqual(expect.arrayContaining([
      'package', 'branch', 'remote-sync', 'clean-tree', 'build', 'dist-artifacts',
      'tag-conflict', 'version-bump', 'git-push', 'pr-create', 'private-flag', 'npm-publish-verify',
    ]));
    expect(source).not.toContain('process.exit');
  });
});
