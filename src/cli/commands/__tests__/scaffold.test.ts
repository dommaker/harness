/**
 * scaffold 模块测试（harness#132，架构评审候选3）
 *
 * 覆盖三件事：
 * 1. 三态判定（created / exists / manual）的形状——判定、建目录、上色、片段打印
 *    全在实现内，测试注入内存 fs 替身，零真实文件系统。
 * 2. 9 站点（init 7 + validate 2）的对外文案逐字冻结：新增站点的每一行按同一形状
 *    冻结（pre-push 是 harness#144 加的第 9 处），其余站点改前后用户看到的都一样。
 * 3. 「打印给用户的片段 == 真正落盘的内容」同源不变量（#103 判据）的单点断言。
 * 4. CI 站点的平台维度（harness#143）：同一站点在 github / gitlab 两形下各自的
 *    目标路径、三态文案与冲突片段。
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { captureIO, type CapturingIO } from '../../command-contract';
import {
  GITHUB_ACTIONS_SNIPPET,
  GITLAB_CI_SNIPPET,
  HARNESS_CHECK_WORKFLOW,
} from '../scaffold-templates';
import {
  writeManagedFile,
  runPlan,
  preCommitHookFile,
  prePushHookFile,
  harnessCheckCiFile,
  changelogFile,
  contextDocFile,
  governanceWorkflowFile,
  checkpointsFile,
  resolutionsFile,
  type ManagedFile,
  type ScaffoldFileSystem,
} from '../scaffold';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

/** 内存 fs 替身：写盘内容、建过的目录、权限位全部可断言 */
class MemoryFs implements ScaffoldFileSystem {
  readonly files = new Map<string, string>();
  readonly dirs: string[] = [];
  readonly modes = new Map<string, number>();

  seed(target: string, content: string): void {
    this.files.set(target, content);
  }
  async exists(target: string): Promise<boolean> {
    return this.files.has(target);
  }
  async mkdir(dir: string): Promise<void> {
    this.dirs.push(dir);
  }
  async writeFile(target: string, content: string): Promise<void> {
    this.files.set(target, content);
  }
  async chmod(target: string, mode: number): Promise<void> {
    this.modes.set(target, mode);
  }
}

const PROJECT = '/srv/project';
const USER_CONTENT = '用户自己的内容，不许覆盖\n';

/** 全部 8 站点，顺序 = init 的落盘顺序 */
function allSites(): ManagedFile[] {
  return [
    checkpointsFile(PROJECT),
    resolutionsFile(PROJECT),
    preCommitHookFile(PROJECT),
    prePushHookFile(PROJECT),
    harnessCheckCiFile(PROJECT, 'github', ['ci.yml']),
    changelogFile(PROJECT, 'keep-a-changelog'),
    contextDocFile(PROJECT, 'src'),
    governanceWorkflowFile(PROJECT, 'standard'),
  ];
}

/** stdout 每次写入的文本（去掉 log 补的换行，空行即为 ''） */
function printed(io: CapturingIO): string[] {
  return io.outRecords().map(chunk => chunk.replace(/\n$/, ''));
}

function mergeOf(file: ManagedFile): Extract<ManagedFile['onPresent'], { outcome: 'merge' }> {
  if (file.onPresent.outcome !== 'merge') throw new Error(`${file.target} 不是 merge 站点`);
  return file.onPresent;
}

function noticeOf(file: ManagedFile): string {
  if (file.onPresent.outcome !== 'skip') throw new Error(`${file.target} 不是 skip 站点`);
  return file.onPresent.notice;
}

let fs: MemoryFs;
let io: CapturingIO;

beforeEach(() => {
  jest.clearAllMocks();
  fs = new MemoryFs();
  io = captureIO();
});

describe('writeManagedFile：三态判定', () => {
  it('不在场 → created：建父目录、落盘模板正文、绿字告知', async () => {
    const file = changelogFile(PROJECT, 'keep-a-changelog');

    expect(await writeManagedFile(file, io, fs)).toBe('created');

    expect(fs.dirs).toContain(path.dirname(file.target));
    expect(fs.files.get(file.target)).toBe(file.content);
    expect(printed(io)).toEqual([file.created]);
    expect(chalk.green).toHaveBeenCalledWith(file.created);
  });

  it('声明 mode 才 chmod，缺省不动权限位', async () => {
    expect(await writeManagedFile(preCommitHookFile(PROJECT), io, fs)).toBe('created');
    expect(fs.modes.get(path.join(PROJECT, '.git/hooks/pre-commit'))).toBe(0o755);

    fs = new MemoryFs();
    io = captureIO();
    expect(await writeManagedFile(prePushHookFile(PROJECT), io, fs)).toBe('created');
    expect(fs.modes.get(path.join(PROJECT, '.git/hooks/pre-push'))).toBe(0o755);

    fs = new MemoryFs();
    io = captureIO();
    expect(await writeManagedFile(changelogFile(PROJECT, 'keep-a-changelog'), io, fs)).toBe('created');
    expect(fs.modes.size).toBe(0);
  });

  it('在场 + skip → exists：灰字告知，用户内容一字节不动', async () => {
    const file = changelogFile(PROJECT, 'keep-a-changelog');
    fs.seed(file.target, USER_CONTENT);

    expect(await writeManagedFile(file, io, fs)).toBe('exists');

    expect(fs.files.get(file.target)).toBe(USER_CONTENT);
    expect(fs.dirs).toEqual([]);
    expect(printed(io)).toEqual([noticeOf(file)]);
    expect(chalk.gray).toHaveBeenCalledWith(noticeOf(file));
  });

  it('在场 + merge → manual：提示 + 指引 + 空行 + cyan 片段，用户内容一字节不动', async () => {
    const file = preCommitHookFile(PROJECT);
    const userHook = '#!/bin/sh\n# 用户自己的钩子\n';
    fs.seed(file.target, userHook);

    expect(await writeManagedFile(file, io, fs)).toBe('manual');

    const merge = mergeOf(file);
    expect(printed(io)).toEqual([merge.notice, merge.instruction, '', merge.snippet]);
    expect(chalk.yellow).toHaveBeenCalledWith(merge.notice);
    expect(chalk.cyan).toHaveBeenCalledWith(merge.snippet);
    expect(fs.files.get(file.target)).toBe(userHook);
    expect(fs.modes.has(file.target)).toBe(false);
  });

  it('present 覆写：冲突判定可以不落在 target 自身（GH Actions 站点按同目录既有 CI 判）', async () => {
    const withCi = harnessCheckCiFile(PROJECT, 'github', ['ci.yml']);
    fs.seed(path.join(PROJECT, '.github/workflows/ci.yml'), 'name: CI\n');

    expect(await writeManagedFile(withCi, io, fs)).toBe('manual');
    expect(fs.files.has(withCi.target)).toBe(false);
    expect(printed(io)[1]).toBe('  - .github/workflows/ci.yml');

    io = captureIO();
    expect(await writeManagedFile(harnessCheckCiFile(PROJECT, 'github', []), io, fs)).toBe('created');
    expect(fs.files.get(withCi.target)).toBe(withCi.content);
  });

  it('runPlan 按顺序逐站点落盘并逐站点回报状态', async () => {
    const plan = [checkpointsFile(PROJECT), changelogFile(PROJECT, 'keep-a-changelog')];
    fs.seed(plan[1].target, USER_CONTENT);

    expect(await runPlan(plan, io, fs)).toEqual(['created', 'exists']);
    expect(printed(io)).toEqual([plan[0].created, noticeOf(plan[1])]);
  });
});

describe('init 的脚手架 plan 站点面', () => {
  it('8 站点齐备且目标路径逐字冻结（init 6 + validate 2 同源收口）', () => {
    expect(allSites().map(f => f.target)).toEqual([
      `${PROJECT}/.harness/checkpoints.yml`,
      `${PROJECT}/.harness/resolutions.json`,
      `${PROJECT}/.git/hooks/pre-commit`,
      `${PROJECT}/.git/hooks/pre-push`,
      `${PROJECT}/.github/workflows/harness-check.yml`,
      `${PROJECT}/CHANGELOG.md`,
      `${PROJECT}/src/CONTEXT.md`,
      `${PROJECT}/.github/workflows/harness-governance.yml`,
    ]);
  });

  it('治理 workflow 正文随治理级别增减 docs check（模板作数据，级别是入参）', () => {
    const strict = governanceWorkflowFile(PROJECT, 'strict').content;
    const minimal = governanceWorkflowFile(PROJECT, 'minimal').content;

    expect(strict).toContain('npx @dommaker/harness sync-docs --check');
    expect(minimal).not.toContain('sync-docs');
    expect(minimal).toContain('npx @dommaker/harness passes-gate');
  });

  it('changelog 模板两档正文各自可辨', () => {
    expect(changelogFile(PROJECT, 'keep-a-changelog').content).toContain('Keep a Changelog');
    expect(changelogFile(PROJECT, 'simple').content).not.toContain('Keep a Changelog');
  });

  it('CONTEXT.md 模板按目录渲染', () => {
    const content = contextDocFile(PROJECT, 'src').content;
    expect(content).toContain('# src');
    expect(content).toContain('## 职责');
  });
});

describe('CI 站点的平台维度（harness#143）', () => {
  /** governanceLevel 入参 = init 的 `-g` 档；gitlab 形下治理任务并入同一文件 */
  const gitlabCi = (governanceLevel?: string) =>
    harnessCheckCiFile(PROJECT, 'gitlab', [], governanceLevel);

  it('目标路径按平台给：gitlab → .gitlab-ci.yml，github → workflow 文件', () => {
    expect(gitlabCi().target).toBe(`${PROJECT}/.gitlab-ci.yml`);
    expect(harnessCheckCiFile(PROJECT, 'github', []).target).toBe(
      `${PROJECT}/.github/workflows/harness-check.yml`,
    );
  });

  it('三态文案逐字冻结：落盘态绿字 / 在场态提示 + 指引 + 空行 + 片段', async () => {
    const memoryFs = new MemoryFs();
    expect(await writeManagedFile(gitlabCi(), io, memoryFs)).toBe('created');
    expect(printed(io)).toEqual(['✅ 已创建 .gitlab-ci.yml']);

    io = captureIO();
    const file = gitlabCi('standard');
    memoryFs.seed(file.target, USER_CONTENT);
    expect(await writeManagedFile(file, io, memoryFs)).toBe('manual');
    expect(printed(io).slice(0, 2)).toEqual([
      '⚠️  .gitlab-ci.yml 已存在',
      '💡 请手动添加以下内容到文件中：',
    ]);
    expect(printed(io)[2]).toBe('');
    expect(memoryFs.files.get(file.target)).toBe(USER_CONTENT);
  });

  it('冲突面 = target 自身（gitlab 没有「同目录任何 CI 配置即冲突」那一条，GH 侧判定不变）', async () => {
    const memoryFs = new MemoryFs();
    memoryFs.seed(`${PROJECT}/.gitlab/ci/other.yml`, 'x\n');
    expect(await writeManagedFile(gitlabCi(), io, memoryFs)).toBe('created');

    io = captureIO();
    expect(await writeManagedFile(harnessCheckCiFile(PROJECT, 'github', ['ci.yml']), io, memoryFs)).toBe(
      'manual',
    );
  });

  it('落盘正文与 GH 版对仗：同三条命令、image: node:20、stage: test、rules 触发、无缓存', () => {
    const content = gitlabCi().content;
    for (const cmd of ['check', 'validate', 'passes-gate']) {
      expect(content).toContain(`npx @dommaker/harness ${cmd}`);
    }
    expect(content).toContain('image: node:20');
    expect(content).toContain('stage: test');
    expect(content).toContain('- if: $CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(content).toContain('- if: $CI_COMMIT_BRANCH == "main"');
    expect(content).toContain('- if: $CI_COMMIT_BRANCH == "master"');
    expect(content).not.toMatch(/(^|\n)only:/);
    expect(content).not.toMatch(/(^|\n)cache:/);
  });

  it('治理档并入同一文件，docs 新鲜度检查非阻断 = allow_failure: true', () => {
    const standard = gitlabCi('standard').content;
    expect(standard).toContain('harness-governance:');
    expect(standard).toContain('harness-docs-freshness:');
    expect(standard).toContain('npx @dommaker/harness sync-docs --check');
    expect(standard).toContain('allow_failure: true');
    expect(gitlabCi('minimal').content).toContain('harness-governance:');
    expect(gitlabCi('minimal').content).not.toContain('sync-docs');
    expect(gitlabCi().content).not.toContain('harness-governance:');
  });

  it('落盘正文是合法 YAML（自建的 GitLab 实例不吃坏文件）', () => {
    for (const level of [undefined, 'minimal', 'strict']) {
      const doc = yaml.load(gitlabCi(level).content) as Record<string, unknown>;
      expect(doc).toHaveProperty('image', 'node:20');
      expect(doc).toHaveProperty('stages', ['test']);
      expect(Object.keys(doc).filter(k => k.startsWith('harness-'))).toEqual(
        level === undefined ? ['harness-check'] : level === 'minimal'
          ? ['harness-check', 'harness-governance']
          : ['harness-check', 'harness-governance', 'harness-docs-freshness'],
      );
      const docs = doc['harness-docs-freshness'] as { allow_failure?: boolean } | undefined;
      if (docs) expect(docs.allow_failure).toBe(true);
    }
  });

  it('github 形不受平台参数影响：治理站仍是独立 workflow 文件', () => {
    expect(governanceWorkflowFile(PROJECT, 'standard').target).toBe(
      `${PROJECT}/.github/workflows/harness-governance.yml`,
    );
    expect(governanceWorkflowFile(PROJECT, 'standard').content).toContain('name: Harness Governance');
  });
});

describe('对外文案逐字冻结（9 站点 × 落盘态 / 在场态）', () => {
  /** build 入参 = 该站点运行期发现的既有 CI 配置清单（只有 GH Actions 站点用它判冲突） */
  type SiteBuilder = (existingCiWorkflows: string[]) => ManagedFile;

  /** presentRecords = 在场态除片段外的逐字行（merge 站点片段另由同源闸钉住） */
  const cases: Array<[string, SiteBuilder, string, string[], string?]> = [
    [
      'pre-commit',
      () => preCommitHookFile(PROJECT),
      '✅ 已创建 .git/hooks/pre-commit',
      ['⚠️  .git/hooks/pre-commit 已存在', '💡 请手动添加以下内容到文件末尾：'],
      'echo "🔍 Running harness checks..."',
    ],
    [
      'pre-push',
      () => prePushHookFile(PROJECT),
      '✅ 已创建 .git/hooks/pre-push',
      ['⚠️  .git/hooks/pre-push 已存在', '💡 请手动添加以下内容到文件末尾：'],
      'echo "🔍 Running harness pre-push checks (whole repo)..."',
    ],
    [
      'harness-check.yml',
      ci => harnessCheckCiFile(PROJECT, 'github', ci),
      '✅ 已创建 .github/workflows/harness-check.yml',
      [
        '⚠️  检测到已存在的 CI 配置：',
        '  - .github/workflows/ci.yml',
        '💡 请手动添加以下内容到 jobs 中：',
      ],
      'name: Harness Check',
    ],
    [
      'checkpoints.yml',
      () => checkpointsFile(PROJECT),
      '✅ 已创建示例检查点文件: /srv/project/.harness/checkpoints.yml',
      ['checkpoints.yml 已存在，跳过'],
      '',
    ],
    [
      'resolutions.json',
      () => resolutionsFile(PROJECT),
      '✅ 已创建 Resolutions 文件: /srv/project/.harness/resolutions.json',
      ['resolutions.json 已存在，跳过'],
      '',
    ],
    [
      'CHANGELOG.md',
      () => changelogFile(PROJECT, 'keep-a-changelog'),
      '✅ 已创建 CHANGELOG.md',
      ['CHANGELOG.md 已存在'],
      '',
    ],
    [
      'CONTEXT.md',
      () => contextDocFile(PROJECT, 'src'),
      '✅ 已创建 src/CONTEXT.md',
      ['src/CONTEXT.md 已存在'],
      '',
    ],
    [
      'harness-governance.yml',
      () => governanceWorkflowFile(PROJECT, 'standard'),
      '✅ 已创建 .github/workflows/harness-governance.yml',
      ['harness-governance.yml 已存在'],
      '',
    ],
  ];

  it.each(cases)('%s 落盘态', async (_label, build, created) => {
    const memoryFs = new MemoryFs();
    const file = build([]);
    expect(await writeManagedFile(file, io, memoryFs)).toBe('created');
    expect(printed(io)).toEqual([created]);
    expect(memoryFs.files.size).toBe(1);
    expect(memoryFs.files.get(file.target)).toBe(file.content);
  });

  it.each(cases)('%s 在场态（第三态）', async (_label, build, _created, presentRecords, snippetHead) => {
    const memoryFs = new MemoryFs();
    const file = build(['ci.yml']);
    memoryFs.seed(file.target, USER_CONTENT);

    await writeManagedFile(file, io, memoryFs);

    const lines = printed(io);
    expect(lines.slice(0, presentRecords.length)).toEqual(presentRecords);
    if (snippetHead) {
      // merge 站点：指引之后是空行 + 片段本体
      expect(lines[presentRecords.length]).toBe('');
      expect(lines.slice(presentRecords.length + 1).join('\n')).toContain(snippetHead);
    } else {
      expect(lines).toEqual(presentRecords);
    }
    expect(memoryFs.files.get(file.target)).toBe(USER_CONTENT);
  });
});

describe('打印片段与落盘内容同源（#103 判据）', () => {
  /** 片段必须是落盘正文的一部分（或逐字等于正文），否则用户手工合并的是另一份文本 */
  function snippetDrift(file: ManagedFile): string | undefined {
    if (file.onPresent.outcome !== 'merge') return undefined;
    return file.content.includes(file.onPresent.snippet) ? undefined : `${file.target}: 打印片段不在落盘正文里`;
  }

  it('merge 站点全部同源', () => {
    expect(allSites().map(snippetDrift).filter(Boolean)).toEqual([]);
  });

  it('CI 站点的两种平台形全部同源（gitlab 三档治理形一并入闸）', () => {
    const ciSites = [
      harnessCheckCiFile(PROJECT, 'github', ['ci.yml']),
      harnessCheckCiFile(PROJECT, 'gitlab', []),
      harnessCheckCiFile(PROJECT, 'gitlab', [], 'minimal'),
      harnessCheckCiFile(PROJECT, 'gitlab', [], 'standard'),
    ];
    expect(ciSites.map(snippetDrift).filter(Boolean)).toEqual([]);
  });

  it('GitLab 站点冲突分支打印 job 片段，且片段是落盘全文正本的一部分', () => {
    const plain = mergeOf(harnessCheckCiFile(PROJECT, 'gitlab', [])).snippet;
    const governed = mergeOf(harnessCheckCiFile(PROJECT, 'gitlab', [], 'standard')).snippet;

    expect(plain).toBe(GITLAB_CI_SNIPPET);
    expect(plain).toContain('harness-check:');
    expect(plain).not.toContain('image:');
    expect(governed.startsWith(plain)).toBe(true);
    expect(governed).toContain('harness-docs-freshness:');
  });

  it('GH Actions 站点冲突分支打印完整 workflow 正文（不再是 job 片段）', () => {
    const file = harnessCheckCiFile(PROJECT, 'github', ['ci.yml']);
    const snippet = mergeOf(file).snippet;

    expect(snippet).toBe(file.content);
    expect(snippet).toContain('name: Harness Check');
    expect(snippet).toContain('npx @dommaker/harness passes-gate');
  });

  it('GH 片段视图是落盘正本裁出来的一段，不是第二份手抄文本（#153）', () => {
    expect(HARNESS_CHECK_WORKFLOW.includes(GITHUB_ACTIONS_SNIPPET)).toBe(true);
  });

  it('pre-commit 站点落盘正文 = 打印片段 + shebang 头', () => {
    const file = preCommitHookFile(PROJECT);
    expect(file.content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(file.content.endsWith(mergeOf(file).snippet)).toBe(true);
  });

  it('pre-push 站点落盘正文 = 打印片段 + shebang 头（#103 判据）', () => {
    const file = prePushHookFile(PROJECT);
    expect(file.content.startsWith('#!/bin/sh\n# Harness pre-push hook\n')).toBe(true);
    expect(file.content.endsWith(mergeOf(file).snippet)).toBe(true);
  });

  it('pre-push 跑整仓全量兜底：check 不带 --staged + validate，恰好这两道', () => {
    const body = prePushHookFile(PROJECT).content;

    expect(body).toContain('npx @dommaker/harness check');
    expect(body).not.toContain('check --staged');
    expect(body).toContain('npx @dommaker/harness validate');
    expect(body.match(/npx @dommaker\/harness/g)).toHaveLength(2);
  });

  it('pre-push 不做增量、不内建逃生机制（决议：唯一逃生口是 git 原生 --no-verify）', () => {
    const body = prePushHookFile(PROJECT).content;

    // 不解析 pre-push 从 stdin 收到的 <local_ref> <local_oid> <remote_ref> <remote_oid> 清单
    expect(body).not.toMatch(/\bwhile read\b|local_ref|remote_ref/);
    // 无环境变量开关、无超时、无「慢则降级」
    expect(body).not.toMatch(/\$\{?[A-Z][A-Z0-9_]*\}?/);
    expect(body).not.toMatch(/\btimeout\b/);
  });

  it.each(['pre-commit', 'pre-push'] as const)(
    '闸非空洞：%s 落盘正文被改动而片段未跟进 → 报出该站点',
    which => {
      const build = which === 'pre-commit' ? preCommitHookFile : prePushHookFile;
      const drifted: ManagedFile = {
        ...build(PROJECT),
        content: '#!/bin/sh\n# 悄悄改了这里\n',
      };
      expect(snippetDrift(drifted)).toContain(which);
    },
  );
});
