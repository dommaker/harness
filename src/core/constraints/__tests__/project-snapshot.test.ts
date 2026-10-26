/**
 * 运行级 ProjectSnapshot（P1.2）：遍历排除、文件/目录契约、读取与解析复用
 *
 * 钉五个行为（旧实现下全红——file-exists 每次 evaluate 全仓裸走一遍且下钻 .git，
 * regex-scan 每文件现编译 glob、每约束各读各的文件、各解析各的 diff）：
 * ① 遍历精确跳过 .git 与 node_modules；dist/coverage 不排除（构建产物是
 *    file-exists 的合法判定对象，既有契约 dist/** 可命中）；
 * ② 受管理隐藏目录 .harness 照常可匹配（不能 skipHidden 一刀切）；
 * ③ file-exists 对文件与目录都可命中的契约不变；
 * ④ 同一枚 RunEnv 内多条约束共享一次遍历 / 同一文件读取 / 同一 diff 解析；
 * ⑤ glob 在 checker 创建时编译一次，不在扫描期间重复编译；
 * ⑥ 跨 run（两枚 RunEnv）快照各自独立。
 */

import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRunEnv, projectSnapshotFor } from '../run-env';
import { createProjectSnapshot } from '../project-snapshot';
import { fileExists } from '../checkers/templated/file-exists';
import { regexScan } from '../checkers/templated/regex-scan';
import { noHardcodedCredentials } from '../checkers/no-hardcoded-credentials';
import { noTestSimplification } from '../checkers/no-test-simplification';
import { buildCheckEnv, normalizeCheckOutcome, type CheckEnv, type CheckOutcome } from '../checkers/types';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { globToRegExp } from '../../../utils/glob-match';
import { parseUnifiedDiff } from '../../../utils/diff-parse';
import { walkFiles } from '../../../utils/file-walk';

// 计数手法同 run-cache-lifecycle.test.ts / run-env.test.ts：
// 包一层真实实现做调用计数，夹具搭建与被测代码都不受影响
jest.mock('../../../utils/file-walk', () => {
  const actual = jest.requireActual<typeof import('../../../utils/file-walk')>(
    '../../../utils/file-walk'
  );
  return { ...actual, walkFiles: jest.fn(actual.walkFiles) };
});

jest.mock('../../../utils/glob-match', () => {
  const actual = jest.requireActual<typeof import('../../../utils/glob-match')>(
    '../../../utils/glob-match'
  );
  return { ...actual, globToRegExp: jest.fn(actual.globToRegExp) };
});

jest.mock('../../../utils/diff-parse', () => {
  const actual = jest.requireActual<typeof import('../../../utils/diff-parse')>(
    '../../../utils/diff-parse'
  );
  return { ...actual, parseUnifiedDiff: jest.fn(actual.parseUnifiedDiff) };
});

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

const walkCalls = () => (walkFiles as jest.Mock).mock.calls.length;
const globCompileCalls = () => (globToRegExp as jest.Mock).mock.calls.length;
const diffParseCalls = () => (parseUnifiedDiff as jest.Mock).mock.calls.length;
const readSpy = (fs as unknown as { readFileSync: jest.Mock }).readFileSync;
const readsOf = (rel: string) =>
  readSpy.mock.calls.filter(call => call[0] === rel || String(call[0]).endsWith(path.sep + rel) || String(call[0]).endsWith('/' + rel)).length;

const passed = (outcome: CheckOutcome): boolean => normalizeCheckOutcome(outcome).satisfied;
const evidenceText = (outcome: CheckOutcome): string =>
  normalizeCheckOutcome(outcome).evidence.join('\n');

/** 全量夹具：.git 深层对象、依赖、构建产物、覆盖率、受管隐藏目录、常规源码 */
function fullFixture(): string {
  return createProjectFixture({
    name: 'project-snapshot',
    files: {
      'src/a.ts': 'export const a = 1;\n',
      '.harness/config.yml': 'preset: standard\n',
      '.git/objects/ab/cdef0123': 'git-object-bytes\n',
      'node_modules/pkg/index.js': 'module.exports = 1;\n',
      'dist/out.js': 'build artifact\n',
      'coverage/lcov.info': 'SF:src/a.ts\n',
      'docs/guide.md': '# guide\n',
    },
  });
}

function makeEnv(projectPath: string, changedFiles: string[] = []): CheckEnv {
  return buildCheckEnv(
    { operation: 'commit', projectPath, changedFiles },
    {
      stagedDiff: async () => '',
      stagedDiffNames: async () => changedFiles.join('\n'),
      srcScan: () => [],
      available: () => true,
    },
    createRunEnv(projectPath)
  );
}

describe('ProjectSnapshot 遍历排除语义', () => {
  let dir: string;

  beforeEach(() => {
    dir = fullFixture();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('精确跳过 .git：任何层级都不下钻，但其余文件照常进清单', () => {
    const files = createProjectSnapshot(dir).files();
    expect(files.some(f => f === '.git' || f.startsWith('.git/'))).toBe(false);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('docs/guide.md');
  });

  it('node_modules 跳过；dist/coverage 不排除（构建产物是 file-exists 合法判定对象）', () => {
    const files = createProjectSnapshot(dir).files();
    expect(files.some(f => f === 'node_modules' || f.startsWith('node_modules/'))).toBe(false);
    expect(files).toContain('dist/out.js');
    expect(files).toContain('coverage/lcov.info');
  });

  it('.harness 等受管隐藏目录照常进清单（不能 skipHidden 一刀切）', () => {
    const files = createProjectSnapshot(dir).files();
    expect(files).toContain('.harness');
    expect(files).toContain('.harness/config.yml');
  });

  it('清单含目录与文件（includeDirs 口径），一次 run 内重复取不重复遍历', () => {
    const snap = createProjectSnapshot(dir);
    const before = walkCalls();
    const first = snap.files();
    expect(first).toContain('docs');
    expect(snap.files()).toBe(first);
    expect(walkCalls() - before).toBe(1);
  });
});

describe('file-exists 契约（经 snapshot 匹配）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fullFixture();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('glob 命中 .harness 下文件：mustExist=true 通过', async () => {
    const check = fileExists.create('app_harness_cfg', { glob: '.harness/**' });
    expect(passed(await check.evaluate(makeEnv(dir)))).toBe(true);
  });

  it('文件与目录都可命中：glob=docs 命中目录本身', async () => {
    const dirHit = fileExists.create('app_docs_dir', { glob: 'docs' });
    expect(passed(await dirHit.evaluate(makeEnv(dir)))).toBe(true);

    const fileHit = fileExists.create('app_docs_file', { glob: 'docs/**' });
    expect(passed(await fileHit.evaluate(makeEnv(dir)))).toBe(true);
  });

  it('mustExist=false + glob=dist/**：构建产物仍点名进证据（dist 不在排除名单）', async () => {
    const check = fileExists.create('app_no_dist', { glob: 'dist/**', mustExist: false });
    const outcome = await check.evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('dist/out.js');
  });

  it('mustExist=false：.git 下的文件永远不可命中（遍历不下钻）', async () => {
    const check = fileExists.create('app_no_git_obj', { glob: '.git/**', mustExist: false });
    expect(passed(await check.evaluate(makeEnv(dir)))).toBe(true);
  });
});

describe('run 内共享：一次遍历、同一读取、同一解析', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-snapshot-share-'));
    const write = (rel: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
    };
    write('src/conf.ts', 'export const u = "http://10.9.9.9";\n');
    write('docs/a.md', 'a\n');
    write('docs/b.md', 'b\n');
    readSpy.mockClear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('两条 file-exists 约束共享一次遍历（底层 walkFiles 只调用一次）', async () => {
    const env = makeEnv(dir);
    const checkA = fileExists.create('app_docs_md', { glob: 'docs/**/*.md' });
    const checkB = fileExists.create('app_src_ts', { glob: 'src/**' });

    const before = walkCalls();
    expect(passed(await checkA.evaluate(env))).toBe(true);
    expect(passed(await checkB.evaluate(env))).toBe(true);
    expect(walkCalls() - before).toBe(1);
  });

  it('两条 regex-scan 约束读同一变更文件：内容至多读一次', async () => {
    const env = makeEnv(dir, ['src/conf.ts']);
    const checkA = regexScan.create('app_url_a', { pattern: 'https?://10\\.', scope: 'content' });
    const checkB = regexScan.create('app_url_b', { pattern: 'internal-host', scope: 'content' });

    const before = readsOf('src/conf.ts');
    expect(passed(await checkA.evaluate(env))).toBe(false);
    expect(passed(await checkB.evaluate(env))).toBe(true);
    expect(readsOf('src/conf.ts') - before).toBe(1);
  });

  it('两条 regex-scan 约束解析同一 staged diff：parseUnifiedDiff 只调用一次', async () => {
    const diff = [
      'diff --git a/src/conf.ts b/src/conf.ts',
      '--- a/src/conf.ts',
      '+++ b/src/conf.ts',
      '@@ -1,1 +1,2 @@',
      ' const x = 1;',
      '+const u = "http://10.9.9.9";',
    ].join('\n');
    const env = buildCheckEnv(
      { operation: 'commit', projectPath: dir, changedFiles: ['src/conf.ts'] },
      {
        stagedDiff: async () => diff,
        stagedDiffNames: async () => 'src/conf.ts',
        srcScan: () => [],
        available: () => true,
      },
      createRunEnv(dir)
    );
    const checkA = regexScan.create('app_diff_a', { pattern: 'https?://10\\.' });
    const checkB = regexScan.create('app_diff_b', { pattern: 'never-match' });

    const before = diffParseCalls();
    expect(passed(await checkA.evaluate(env))).toBe(false);
    expect(passed(await checkB.evaluate(env))).toBe(true);
    expect(diffParseCalls() - before).toBe(1);
  });
});

describe('snapshot() 可选成员：旧式手写 env 兼容边界', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-snapshot-legacy-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'conf.ts'), 'export const a = 1;\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('旧式 CheckEnv（不含 snapshot 成员）仍可赋值编译', () => {
    // 不写 snapshot——若 RunEnv.snapshot 变回必需成员，本文件编译即红（公共类型回归闸）
    const legacyEnv: CheckEnv = {
      projectPath: dir,
      context: { operation: 'commit', projectPath: dir },
      sourceRoots: () => [],
      rawConfig: () => undefined,
      capabilities: () => undefined,
      srcScan: () => [],
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      evidenceAvailable: () => true,
    };
    expect(legacyEnv.projectPath).toBe(dir);
  });

  it('经 helper 取快照：env 未提供时构造一次性 fallback，checker 照常评估', async () => {
    const legacyEnv: CheckEnv = {
      projectPath: dir,
      context: { operation: 'commit', projectPath: dir },
      sourceRoots: () => [],
      rawConfig: () => undefined,
      capabilities: () => undefined,
      srcScan: () => [],
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      evidenceAvailable: () => true,
    };
    // fallback 是「用完即弃」的一次性读取语义（同 RunTarget 传路径形状），不抛错、不要求补成员
    const snap = projectSnapshotFor(legacyEnv);
    expect(snap.files()).toContain('src/conf.ts');

    const check = fileExists.create('app_legacy', { glob: 'src/**' });
    expect(passed(await check.evaluate(legacyEnv))).toBe(true);
  });
});

describe('内置 checker 共享同一内容读取与 diff 解析', () => {
  let dir: string;
  const DIFF_ONE_HIT = [
    'diff --git a/src/conf.ts b/src/conf.ts',
    '--- a/src/conf.ts',
    '+++ b/src/conf.ts',
    '@@ -1,1 +1,2 @@',
    ' const x = 1;',
    '+const dbPass' + 'word = "Super' + 'Secret123";',
  ].join('\n');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-snapshot-builtin-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'conf.ts'), 'export const dbPass' + 'word = "Super' + 'Secret123";\n', 'utf-8');
    readSpy.mockClear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 生产形状：同一枚 createRunEnv 经 buildCheckEnv 供给全部 checker */
  function prodEnv(diff: string, changedFiles: string[]): CheckEnv {
    return buildCheckEnv(
      { operation: 'commit', projectPath: dir, changedFiles },
      {
        stagedDiff: async () => diff,
        stagedDiffNames: async () => changedFiles.join('\n'),
        srcScan: () => [],
        available: () => true,
      },
      createRunEnv(dir)
    );
  }

  it('regex-scan / no_hardcoded_credentials / no_test_simplification 解析同一 staged diff：parseUnifiedDiff 只调用一次', async () => {
    const env = prodEnv(DIFF_ONE_HIT, ['src/conf.ts']);
    const before = diffParseCalls();

    const rsOutcome = await regexScan.create('app_diff', { pattern: 'never-match' }).evaluate(env);
    const nhOutcome = await noHardcodedCredentials.evaluate(env);
    const ntOutcome = await noTestSimplification.evaluate(env);

    expect(passed(rsOutcome)).toBe(true);
    expect(passed(nhOutcome)).toBe(false); // 新增行命中口令赋值（检测语义不变）
    expect(passed(ntOutcome)).toBe(true);
    expect(diffParseCalls() - before).toBe(1);
  });

  it('regex-scan 与 no_hardcoded_credentials 退化内容扫描同一文件：readFileSync 只调用一次', async () => {
    const env = prodEnv('', ['src/conf.ts']);
    const before = readsOf('src/conf.ts');

    const rsOutcome = await regexScan.create('app_content', { pattern: 'never-match', scope: 'content' }).evaluate(env);
    const nhOutcome = await noHardcodedCredentials.evaluate(env);

    expect(passed(rsOutcome)).toBe(true);
    expect(passed(nhOutcome)).toBe(false); // 文件内容命中口令赋值（检测语义不变）
    expect(readsOf('src/conf.ts') - before).toBe(1);
  });
});

describe('glob 编译时机与跨 run 隔离', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-snapshot-glob-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'conf.ts'), 'export const u = "http://10.9.9.9";\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('glob 在 checker 创建时编译：多次 evaluate 不重复编译', async () => {
    const before = globCompileCalls();
    const check = regexScan.create('app_scoped', { pattern: 'https?://10\\.', glob: 'src/**', scope: 'content' });
    const env = makeEnv(dir, ['src/conf.ts']);

    await check.evaluate(env);
    await check.evaluate(env);
    // 创建时一次；旧实现每个文件每次 evaluate 都经 matchGlob 现编译
    expect(globCompileCalls() - before).toBe(1);
  });

  it('跨 run 隔离：后一枚 RunEnv 观察到新文件，旧 run 快照不补读', () => {
    const env1 = createRunEnv(dir);
    expect(projectSnapshotFor(env1).files()).not.toContain('src/added.ts');

    fs.writeFileSync(path.join(dir, 'src', 'added.ts'), 'export const b = 2;\n', 'utf-8');

    expect(projectSnapshotFor(createRunEnv(dir)).files()).toContain('src/added.ts');
    expect(projectSnapshotFor(env1).files()).not.toContain('src/added.ts');
  });
});
