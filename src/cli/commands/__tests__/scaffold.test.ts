/**
 * scaffold 模块测试（harness#132，架构评审候选3）
 *
 * 覆盖三件事：
 * 1. 三态判定（created / exists / manual）的形状——判定、建目录、上色、片段打印
 *    全在实现内，测试注入内存 fs 替身，零真实文件系统。
 * 2. 8 站点（init 6 + validate 2）的对外文案逐字冻结：改造前后用户看到的每一行
 *    都一样，差异只在内部形状。
 * 3. 「打印给用户的片段 == 真正落盘的内容」同源不变量（#103 判据）的单点断言。
 */

import * as path from 'path';
import chalk from 'chalk';
import { captureIO, type CapturingIO } from '../../command-contract';
import {
  writeManagedFile,
  runPlan,
  preCommitHookFile,
  harnessCheckWorkflowFile,
  customConstraintsFile,
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
    customConstraintsFile(PROJECT),
    preCommitHookFile(PROJECT),
    harnessCheckWorkflowFile(PROJECT, ['ci.yml']),
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
    const file = customConstraintsFile(PROJECT);

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
    const withCi = harnessCheckWorkflowFile(PROJECT, ['ci.yml']);
    fs.seed(path.join(PROJECT, '.github/workflows/ci.yml'), 'name: CI\n');

    expect(await writeManagedFile(withCi, io, fs)).toBe('manual');
    expect(fs.files.has(withCi.target)).toBe(false);
    expect(printed(io)[1]).toBe('  - .github/workflows/ci.yml');

    io = captureIO();
    expect(await writeManagedFile(harnessCheckWorkflowFile(PROJECT, []), io, fs)).toBe('created');
    expect(fs.files.get(withCi.target)).toBe(withCi.content);
  });

  it('runPlan 按顺序逐站点落盘并逐站点回报状态', async () => {
    const plan = [customConstraintsFile(PROJECT), changelogFile(PROJECT, 'keep-a-changelog')];
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
      `${PROJECT}/.harness/custom-constraints.yml`,
      `${PROJECT}/.git/hooks/pre-commit`,
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

describe('对外文案逐字冻结（8 站点 × 落盘态 / 在场态）', () => {
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
      'harness-check.yml',
      ci => harnessCheckWorkflowFile(PROJECT, ci),
      '✅ 已创建 .github/workflows/harness-check.yml',
      [
        '⚠️  检测到已存在的 CI 配置：',
        '  - .github/workflows/ci.yml',
        '💡 请手动添加以下内容到 jobs 中：',
      ],
      'name: Harness Check',
    ],
    [
      'custom-constraints.yml',
      () => customConstraintsFile(PROJECT),
      '✅ 已创建自定义约束示例: custom-constraints.yml',
      ['custom-constraints.yml 已存在'],
      '',
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

  it('GH Actions 站点冲突分支打印完整 workflow 正文（不再是 job 片段）', () => {
    const file = harnessCheckWorkflowFile(PROJECT, ['ci.yml']);
    const snippet = mergeOf(file).snippet;

    expect(snippet).toBe(file.content);
    expect(snippet).toContain('name: Harness Check');
    expect(snippet).toContain('npx @dommaker/harness passes-gate');
  });

  it('pre-commit 站点落盘正文 = 打印片段 + shebang 头', () => {
    const file = preCommitHookFile(PROJECT);
    expect(file.content.startsWith('#!/bin/sh\n')).toBe(true);
    expect(file.content.endsWith(mergeOf(file).snippet)).toBe(true);
  });

  it('闸非空洞：落盘正文被改动而片段未跟进 → 报出该站点', () => {
    const drifted: ManagedFile = {
      ...preCommitHookFile(PROJECT),
      content: '#!/bin/sh\n# 悄悄改了这里\n',
    };
    expect(snippetDrift(drifted)).toContain('pre-commit');
  });
});
