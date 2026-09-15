/**
 * init 落盘集成测试（harness#132）
 *
 * init.test.ts 把 fs/promises 整体 mock 掉，只能看到「调过 writeFile」，看不到
 * 真写出了什么内容。本文件不 mock 任何 IO：在临时目录里真跑两遍 init——
 * 第一遍断言 8 个受管文件的落盘字节，第二遍（文件已在场且被用户改过）断言
 * 8 站点各自的第三态、用户内容一字节不动、以及「打印片段 == 真正落盘的内容」。
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { init, type InitOptions } from '../init';
import { captureIO, type CapturingIO } from '../../command-contract';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

const INIT_OPTIONS = { preset: 'standard' as const, governance: 'standard' as const };

/** 版本号随发布漂移，冻结时归一化 */
function normalize(text: string, root: string): string {
  return text.split(root).join('<P>').replace(/\(v[\d.]+\)/g, '(v*)');
}

async function makeProject(withGit = true): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-scaffold-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  if (withGit) await fs.mkdir(path.join(root, '.git'));
  return root;
}

/** expected 里的行按顺序出现在 lines 中（中间可夹片段正文等其他行） */
function expectOrderedSubsequence(lines: string[], expected: string[]): void {
  let cursor = -1;
  for (const want of expected) {
    const found = lines.indexOf(want, cursor + 1);
    if (found <= cursor) throw new Error(`第三态缺失或顺序错乱: ${want}\n实际输出:\n${lines.join('\n')}`);
    cursor = found;
  }
}

describe('init 真落盘（无 IO mock）', () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
  });

  it('第一遍：受管文件逐字节落盘，输出与改造前逐字一致', async () => {
    const root = await makeProject();
    roots.push(root);
    const io = captureIO();

    expect(await init({ ...INIT_OPTIONS, projectPath: root }, io)).toEqual({ kind: 'ok' });

    // 治理正本 writer（AGENTS.md/CLAUDE.md 段）按既有契约不接 io，那两行落在 process.stdout，
    // 不在捕获面——本票只冻结 scaffold 站的输出（#132 决议：标记化幂等写不纳入 scaffold）
    expect(normalize(io.outText(), root)).toBe(`🚀 初始化 harness 配置...
配置目录: <P>/.harness
预设: standard
治理级别: standard
✅ 已创建配置文件: <P>/.harness/config.yml (v*)
✅ 已创建示例检查点文件: <P>/.harness/checkpoints.yml
✅ 已创建 Resolutions 文件: <P>/.harness/resolutions.json
✅ 已创建自定义约束示例: custom-constraints.yml
✅ 已创建 .git/hooks/pre-commit
✅ 已创建 .github/workflows/harness-check.yml

📋 设置治理文件...
✅ 已创建 CHANGELOG.md
✅ 已创建 src/CONTEXT.md
治理检查已由 harness-check.yml 覆盖，跳过创建 harness-governance.yml

✅ harness 初始化完成！

下一步:
  1. 编辑 .harness/config.yml 自定义配置
  2. 编辑 .harness/custom-constraints.yml 添加项目约束
  3. 正常开发，每次 git commit 会自动检查约束
  4. 运行 harness status 查看状态

💡 提示: 使用 harness init --print-snippets 查看配置代码片段
`);

    const read = (rel: string) => fs.readFile(path.join(root, rel), 'utf-8');

    const hook = await read('.git/hooks/pre-commit');
    expect(hook.startsWith('#!/bin/sh\n# Harness pre-commit hook\n')).toBe(true);
    expect(hook).toContain('echo "🔍 Running harness checks..."');
    expect(hook).toContain("grep -E 'plans/.*\\.md$|\\.plan\\.md$'");
    expect(hook.endsWith('echo "✅ All checks passed"\n')).toBe(true);
    expect(await read('.github/workflows/harness-check.yml')).toContain('name: Harness Check');
    expect(await read('.harness/custom-constraints.yml')).toContain('custom_constraints:');
    expect(await read('.harness/checkpoints.yml')).toContain('id: build-success');
    expect(JSON.parse(await read('.harness/resolutions.json')).capability_sync).toBeDefined();
    expect(await read('CHANGELOG.md')).toContain('Keep a Changelog');
    expect(await read('src/CONTEXT.md')).toContain('# src');

    const stat = await fs.stat(path.join(root, '.git/hooks/pre-commit'));
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it('第二遍（harness 自己的文件在场）：7 站点走冲突分支，打印片段即磁盘正文', async () => {
    const root = await makeProject();
    roots.push(root);
    await init({ ...INIT_OPTIONS, projectPath: root }, captureIO());

    const io = captureIO();
    await init({ ...INIT_OPTIONS, projectPath: root }, io);
    const lines = io.outLines();

    // 顺序 = init 的落盘顺序；harness-governance.yml（第八站）因既有 workflow 覆盖而跳过
    expectOrderedSubsequence(lines, [
      'checkpoints.yml 已存在，跳过',
      'resolutions.json 已存在，跳过',
      'custom-constraints.yml 已存在',
      '⚠️  .git/hooks/pre-commit 已存在',
      '💡 请手动添加以下内容到文件末尾：',
      '⚠️  检测到已存在的 CI 配置：',
      '  - .github/workflows/harness-check.yml',
      '💡 请手动添加以下内容到 jobs 中：',
      'CHANGELOG.md 已存在',
      'src/CONTEXT.md 已存在',
      '治理检查已由 harness-check.yml 覆盖，跳过创建 harness-governance.yml',
    ]);

    // 同源不变量（#103 判据）：冲突分支打印的就是磁盘上那份正文
    const hook = await fs.readFile(path.join(root, '.git/hooks/pre-commit'), 'utf-8');
    expect(hook.startsWith('#!/bin/sh\n# Harness pre-commit hook\n')).toBe(true);
    expect(io.outText()).toContain(hook.replace('#!/bin/sh\n# Harness pre-commit hook\n', ''));
    const workflow = await fs.readFile(path.join(root, '.github/workflows/harness-check.yml'), 'utf-8');
    expect(io.outText()).toContain(workflow);
  });

  it('第三遍（用户已接管这些文件）：一字节都不改', async () => {
    const root = await makeProject();
    roots.push(root);
    await init({ ...INIT_OPTIONS, projectPath: root }, captureIO());

    const userFiles = {
      '.git/hooks/pre-commit': '#!/bin/sh\n# 我自己的钩子\n',
      '.github/workflows/harness-check.yml': 'name: 我自己的流水线\n',
      '.harness/custom-constraints.yml': 'custom_constraints: {}\n',
      '.harness/checkpoints.yml': 'checkpoints: []\n',
      '.harness/resolutions.json': '{}\n',
      'CHANGELOG.md': '# 我的更新日志\n',
      'src/CONTEXT.md': '# src\n\n我写的\n',
    } as const;
    for (const [rel, content] of Object.entries(userFiles)) {
      await fs.writeFile(path.join(root, rel), content);
    }

    await init({ ...INIT_OPTIONS, projectPath: root }, captureIO());

    for (const [rel, content] of Object.entries(userFiles)) {
      expect(await fs.readFile(path.join(root, rel), 'utf-8')).toBe(content);
    }
  });

  it('治理 CI 站点：无 GH Actions 旗帜时自建，第二遍告知已存在', async () => {
    const root = await makeProject(false);
    roots.push(root);
    const first = captureIO();

    await init({ ...INIT_OPTIONS, githubActions: false, projectPath: root }, first);
    expect(normalize(first.outText(), root)).toContain('✅ 已创建 .github/workflows/harness-governance.yml');
    const governance = await fs.readFile(path.join(root, '.github/workflows/harness-governance.yml'), 'utf-8');
    expect(governance).toContain('name: Harness Governance');
    expect(governance).toContain('npx @dommaker/harness passes-gate');

    const second = captureIO();
    await init({ ...INIT_OPTIONS, githubActions: false, projectPath: root }, second);
    expect(second.outLines()).toContain('harness-governance.yml 已存在');
    expect(await fs.readFile(path.join(root, '.github/workflows/harness-governance.yml'), 'utf-8')).toBe(governance);
  });

  it('无 .git 与无源码目录时仍按原措辞告知，不写任何文件', async () => {
    const root = await makeProject(false);
    roots.push(root);
    await fs.rm(path.join(root, 'src'), { recursive: true });

    const io = captureIO();
    await init({ ...INIT_OPTIONS, governance: undefined, projectPath: root }, io);
    expect(io.outLines()).toContain('⚠️  未检测到 Git 仓库，跳过 Git hooks');

    const withDocsDir = await makeProject(false);
    roots.push(withDocsDir);
    const io2 = captureIO();
    await init({ ...INIT_OPTIONS, projectPath: withDocsDir }, io2);
    expect(io2.outText()).not.toContain('不存在，跳过 CONTEXT.md');
  });
});

// ── CI 平台维度（harness#143）：落盘正文的字节级正本 ─────────────────────

const RULES = `  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_COMMIT_BRANCH == "master"
`;

const GITLAB_PLAIN = `# 由 harness init 生成 —— 以下 harness-* 任务是 harness 的 CI 接线
# 门禁真正生效还需在 GitLab 侧开分支保护：pipeline 成功才允许合并

image: node:20

stages:
  - test

harness-check:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness check
    - npx @dommaker/harness validate
    - npx @dommaker/harness passes-gate
${RULES}`;

const GITLAB_GOVERNED = GITLAB_PLAIN + `
harness-governance:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness check
    - npx @dommaker/harness passes-gate
${RULES}
harness-docs-freshness:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness sync-docs --check
${RULES}  allow_failure: true
`;

/** GitLab 站点的 harness-check 任务正文（冲突分支打印的 job 片段即此份） */
const GITLAB_CHECK_JOB = GITLAB_PLAIN.slice(GITLAB_PLAIN.indexOf('harness-check:'));

const CI_OPTIONS = { preset: 'standard' as const };

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(rel);
    return true;
  } catch {
    return false;
  }
}

describe('init --ci 平台维度（harness#143，真落盘）', () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
  });

  it('--ci gitlab：逐字节落盘 .gitlab-ci.yml，不写 GH workflow，平台持久化进 config.yml', async () => {
    const root = await makeProject();
    roots.push(root);
    const io = captureIO();

    expect(await init({ ...CI_OPTIONS, ci: 'gitlab', projectPath: root }, io)).toEqual({ kind: 'ok' });

    expect(await fs.readFile(path.join(root, '.gitlab-ci.yml'), 'utf-8')).toBe(GITLAB_PLAIN);
    expect(await exists(path.join(root, '.github'))).toBe(false);
    expect(io.outLines()).toContain('✅ 已创建 .gitlab-ci.yml');
    expect(io.outLines()).toContain('CI 平台: gitlab');
    expect(await fs.readFile(path.join(root, '.harness', 'config.yml'), 'utf-8')).toContain(
      'ci:\n  platform: gitlab',
    );
  });

  it('第二趟（.gitlab-ci.yml 已在场）：manual 态，用户内容一字节不动，打印的 job 片段即落盘正文的一部分', async () => {
    const root = await makeProject();
    roots.push(root);
    await init({ ...CI_OPTIONS, ci: 'gitlab', projectPath: root }, captureIO());
    const gitlabFile = path.join(root, '.gitlab-ci.yml');
    const userContent = '# 我自己的流水线\n\ntest:\n  script:\n    - echo hi\n';
    await fs.writeFile(gitlabFile, userContent);

    const io = captureIO();
    await init({ ...CI_OPTIONS, ci: 'gitlab', projectPath: root }, io);

    expect(io.outLines()).toContain('⚠️  .gitlab-ci.yml 已存在');
    expect(io.outLines()).toContain('💡 请手动添加以下内容到文件中：');
    expect(io.outText()).toContain(GITLAB_CHECK_JOB);
    expect(await fs.readFile(gitlabFile, 'utf-8')).toBe(userContent);
    expect(await exists(path.join(root, '.github'))).toBe(false);
  });

  it('--ci gitlab -g standard：治理任务并入同一份 .gitlab-ci.yml，docs 新鲜度 allow_failure: true', async () => {
    const root = await makeProject();
    roots.push(root);
    const io = captureIO();

    await init({ ...INIT_OPTIONS, ci: 'gitlab', projectPath: root }, io);

    expect(await fs.readFile(path.join(root, '.gitlab-ci.yml'), 'utf-8')).toBe(GITLAB_GOVERNED);
    expect(await exists(path.join(root, '.github'))).toBe(false);
    expect(io.outText()).not.toContain('harness-governance.yml');
  });

  it('平台持久化：裸 init 与 --print-snippets 都按 config.yml 的 ci.platform 出面', async () => {
    const root = await makeProject();
    roots.push(root);
    await init({ ...CI_OPTIONS, ci: 'gitlab', projectPath: root }, captureIO());
    await fs.rm(path.join(root, '.gitlab-ci.yml'));

    const bare = captureIO();
    await init({ ...CI_OPTIONS, projectPath: root }, bare);
    expect(bare.outLines()).toContain('✅ 已创建 .gitlab-ci.yml');
    expect(bare.outText()).not.toContain('harness-check.yml');
    expect(await fs.readFile(path.join(root, '.gitlab-ci.yml'), 'utf-8')).toBe(GITLAB_PLAIN);
    // 裸 init 重写 config.yml 时不得丢掉已持久化的平台
    expect(await fs.readFile(path.join(root, '.harness', 'config.yml'), 'utf-8')).toContain(
      'ci:\n  platform: gitlab',
    );

    const snippets = captureIO();
    await init({ ...CI_OPTIONS, printSnippets: true, projectPath: root }, snippets);
    expect(snippets.outLines()).toContain('GitLab CI:');
    expect(snippets.outText()).toContain(GITLAB_CHECK_JOB);
    expect(snippets.outText()).not.toContain('GitHub Actions:');
  });

  it('--ci none 不落任何 CI 文件；--no-github-actions 与之等价并打 deprecation warning', async () => {
    const noneRoot = await makeProject();
    roots.push(noneRoot);
    const none = captureIO();
    await init({ ...CI_OPTIONS, ci: 'none', projectPath: noneRoot }, none);
    expect(await exists(path.join(noneRoot, '.github'))).toBe(false);
    expect(await exists(path.join(noneRoot, '.gitlab-ci.yml'))).toBe(false);
    expect(none.outText()).not.toContain('已废弃');
    expect(await fs.readFile(path.join(noneRoot, '.harness', 'config.yml'), 'utf-8')).toContain(
      'ci:\n  platform: none',
    );

    const legacyRoot = await makeProject();
    roots.push(legacyRoot);
    const legacy = captureIO();
    await init({ ...CI_OPTIONS, githubActions: false, projectPath: legacyRoot }, legacy);
    expect(legacy.outLines()).toContain('⚠️  --no-github-actions 已废弃，请改用 --ci none');
    expect(await exists(path.join(legacyRoot, '.github'))).toBe(false);
    expect(await fs.readFile(path.join(legacyRoot, '.harness', 'config.yml'), 'utf-8')).toContain(
      'ci:\n  platform: none',
    );
  });

  it('--ci gitlab 与 --no-github-actions 同时给出：用法错误且什么都不落盘', async () => {
    const root = await makeProject();
    roots.push(root);
    const io = captureIO();

    const result = await init({ ...CI_OPTIONS, ci: 'gitlab', githubActions: false, projectPath: root }, io);

    expect(result).toEqual({
      kind: 'usage-error',
      reason: expect.stringContaining('--no-github-actions'),
    });
    expect(io.errText()).toContain('用法错误');
    expect(await exists(path.join(root, '.gitlab-ci.yml'))).toBe(false);
    expect(await exists(path.join(root, '.harness', 'config.yml'))).toBe(false);
  });

  it('--ci 非法值：用法错误并列出可取值', async () => {
    const root = await makeProject();
    roots.push(root);
    // CLI 边界：commander 把用户敲的字符串原样递进来，合法域由命令层校验
    const dirty = { ci: 'bitbucket' as unknown as InitOptions['ci'] };

    const result = await init({ ...CI_OPTIONS, ...dirty, projectPath: root }, captureIO());

    expect(result).toEqual({
      kind: 'usage-error',
      reason: expect.stringContaining('github | gitlab | none'),
    });
    expect(await exists(path.join(root, '.gitlab-ci.yml'))).toBe(false);
  });

  it('config.yml 的 ci 段读不动（YAML 解析失败）时回落 github，不炸 init', async () => {
    const root = await makeProject();
    roots.push(root);
    await fs.mkdir(path.join(root, '.harness'), { recursive: true });
    await fs.writeFile(path.join(root, '.harness', 'config.yml'), 'preset: standard\nci:\n  platform: [\n');

    const io = captureIO();
    expect(await init({ ...CI_OPTIONS, projectPath: root }, io)).toEqual({ kind: 'ok' });

    expect(io.outText()).not.toContain('CI 平台');
    expect(await exists(path.join(root, '.github/workflows/harness-check.yml'))).toBe(true);
    expect(await exists(path.join(root, '.gitlab-ci.yml'))).toBe(false);
  });
});

// ── --print-snippets 的 CI 片段视图（harness#153）：打印的 job 正文 == 落盘正本的一段 ──

/**
 * harness-check.yml 的字节级冻结基线（正本：`scaffold-templates.HARNESS_CHECK_WORKFLOW`）。
 * 与 `GITLAB_PLAIN` 同族：改模板必须同步改这份基线，而「同步」这个动作正是拦住门禁被削弱的地方。
 */
const HARNESS_CHECK_BYTES = `name: Harness Check

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  harness-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run harness check
        run: npx @dommaker/harness check

      - name: Run harness validate
        run: npx @dommaker/harness validate

      - name: Run harness passes-gate
        run: npx @dommaker/harness passes-gate
`;

/** 打印面里那份 job 正文（一次 log 调用 = 一条记录；片段自带的首尾换行按基线口径归一） */
function printedJob(io: CapturingIO): string {
  const record = io.outRecords().find(chunk => chunk.includes('harness-check:'));
  if (!record) throw new Error('--print-snippets 没有打印 harness-check 的 job 正文');
  return record.replace(/^\n+/, '').replace(/\n$/, '');
}

/** job 正文（含两空格缩进）的 run 命令清单：按 YAML 解析枚举 steps，不靠子串碰运气 */
function runCommands(jobBody: string): string[] {
  const doc = yaml.load(`jobs:\n${jobBody}`) as {
    jobs: Record<string, { steps?: Array<{ run?: string }> }>;
  };
  return (doc.jobs['harness-check'].steps ?? [])
    .map(step => step.run)
    .filter((run): run is string => run !== undefined);
}

const GH_GUIDANCE_LINE = '添加到 .github/workflows/*.yml 的 jobs 下（以下正文取自 harness-check.yml 的 job 段）';

describe('init --print-snippets 的 GitHub Actions 片段视图（harness#153）', () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
  });

  async function snippetsOfCiView(): Promise<CapturingIO> {
    const root = await makeProject();
    roots.push(root);
    const io = captureIO();
    await init({ ...CI_OPTIONS, printSnippets: true, projectPath: root }, io);
    return io;
  }

  it('同源闸：打印的 job 正文逐字等于落盘正本的 jobs: 段之后（抄回去的就是 init 写出的那一段）', async () => {
    const printed = await snippetsOfCiView();
    const job = printedJob(printed);

    expect(job).toBe(HARNESS_CHECK_BYTES.slice(HARNESS_CHECK_BYTES.indexOf('  harness-check:')));

    const root = await makeProject();
    roots.push(root);
    await init({ ...CI_OPTIONS, projectPath: root }, captureIO());
    const written = await fs.readFile(path.join(root, '.github/workflows/harness-check.yml'), 'utf-8');
    expect(written.includes(job)).toBe(true);
    expect(runCommands(written.slice(written.indexOf('  harness-check:')))).toEqual(runCommands(job));
  });

  it('steps 集合闸：打印的 job 覆盖 check / validate / passes-gate 三道门禁，一道不缺', async () => {
    const printed = await snippetsOfCiView();

    expect(runCommands(printedJob(printed))).toEqual(
      expect.arrayContaining([
        'npx @dommaker/harness check',
        'npx @dommaker/harness validate',
        'npx @dommaker/harness passes-gate',
      ]),
    );
  });

  it('引导语逐字冻结：说清打印的是完整 workflow 的 job 段', async () => {
    const lines = (await snippetsOfCiView()).outLines();

    expect(lines[lines.indexOf('GitHub Actions:') + 1]).toBe(GH_GUIDANCE_LINE);
    expect(lines).not.toContain('添加到 .github/workflows/*.yml 的 jobs 中');
  });
});

