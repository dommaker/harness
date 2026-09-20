/**
 * -p/--project-path 锚定回归（harness#95）
 *
 * 各站点的命令都接受 -p，但真正执行/IO 的一侧过去取 process.cwd()：不 cd 到目标工程调用，
 * 就会拿 A 工程的命令、在 B 目录跑、把证据写进 B；acceptance 的「无 tasks.yml 即跳过」
 * 本身是 passed:true，于是 -p 失效直接表现为假绿。
 *
 * 既有单测全部 mock fs/exec + 假 projectPath，恰好抹平两种取径的差异。本文件不 mock 任何 IO，
 * 前提统一为 **cwd ≠ projectPath**（cwd = A，-p = B），断言读写位置落在 B。
 * 站点 2 从两面各断言一次：CLI 命令面（`acceptance -p`）与门禁实例面（默认构造 = 注册表单例形状）。
 *
 * 站点 3（harness#139）是 trace 落点：`check --project-path B` 的约束评估真跑了 B，
 * 但 trace 写进了 A——写侧不锚，按 projectPath 直读的读侧（`status`）就读不到刚写的记录，
 * 即 #95 点名的假绿族。故本站点从写、读两面各断言一次。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { SpecAcceptanceGate } from '../../../gates/acceptance';
import { DEFAULT_TRACE_FILE } from '../../../types/trace';
import { captureIO } from '../../command-contract';
import { runPassesGate } from '../passes-gate';
import { acceptance } from '../acceptance';
import { check } from '../check';
import { status } from '../status';

/** 在自身 cwd 落标记文件：哪一侧被真正调用，标记就出现在哪一侧的目录里 */
function markScript(marker: string): string {
  return [
    'const fs = require("fs");',
    `fs.writeFileSync("${marker}-exec-location.txt", process.cwd());`,
    'console.log("1 passed");',
    '',
  ].join('\n');
}

const PACKAGE_JSON = JSON.stringify({
  name: 'fixture',
  version: '1.0.0',
  scripts: { test: 'node ./mark.js' },
});

/** acceptance_criteria 形状：checked 决定判定，两侧只差 checked 值 → 读错文件必然改变结论 */
function tasksYml(checked: boolean): string {
  return [
    'tasks:',
    '  - id: TASK-001',
    '    title: 锚定用例',
    '    acceptance_criteria:',
    '      - id: crit-1',
    '        description: 需要人工确认的验收条件',
    '        type: manual',
    '        required: true',
    `        checked: ${checked}`,
    '',
  ].join('\n');
}

/** passes-gate 两侧夹具：A = 调用方所在目录（cwd），B = -p 指向的目标工程 */
function createPassesGateSides(): { cwdSide: string; projectSide: string } {
  return {
    cwdSide: createProjectFixture({
      name: 'pganchor-cwd-side',
      files: { 'package.json': PACKAGE_JSON, 'mark.js': markScript('cwd-side') },
    }),
    projectSide: createProjectFixture({
      name: 'pganchor-project-side',
      files: { 'package.json': PACKAGE_JSON, 'mark.js': markScript('project-side') },
    }),
  };
}

describe('-p 锚定：执行与 IO 必须落在 projectPath（cwd ≠ projectPath）', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  describe('passes-gate（站点 1：执行 + 证据落盘）', () => {
    it('-p 指向 B → B 的 package.json 测试命令在 B 执行，证据落 B/.harness/evidence', async () => {
      const { cwdSide, projectSide } = createPassesGateSides();
      process.chdir(cwdSide);

      const result = await runPassesGate({ projectPath: projectSide }, captureIO());

      expect(result).toEqual({ kind: 'ok' });
      expect(fs.readFileSync(path.join(projectSide, 'project-side-exec-location.txt'), 'utf-8'))
        .toBe(projectSide);
      // 跑在 B 的判据同时要求 A 侧什么都没被执行、没被写入
      expect(fs.existsSync(path.join(cwdSide, 'cwd-side-exec-location.txt'))).toBe(false);
      expect(fs.existsSync(path.join(cwdSide, '.harness', 'evidence'))).toBe(false);

      const evidenceDir = path.join(projectSide, '.harness', 'evidence');
      expect(fs.existsSync(evidenceDir)).toBe(true);
      expect(fs.readdirSync(evidenceDir).filter(f => f.startsWith('test-'))).toHaveLength(1);
    });
  });

  describe('acceptance（站点 2：tasks.yml 解析）', () => {
    it('默认构造的门禁实例（注册表单例形状）→ 读 B/tasks.yml，不读 cwd 的', async () => {
      const cwdSide = createProjectFixture({
        name: 'acccfg-cwd-side',
        files: { 'tasks.yml': tasksYml(true) },
      });
      const projectSide = createProjectFixture({
        name: 'acccfg-project-side',
        files: { 'tasks.yml': tasksYml(false) },
      });
      process.chdir(cwdSide);

      // 无 config 构造 = 注册表单例的形状（./tasks.yml 相对默认值在这一支按 cwd 解析）
      const result = await new SpecAcceptanceGate().check({
        projectPath: projectSide,
        taskId: 'TASK-001',
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('1 unchecked acceptance criteria');
    });

    it('-p 指向 B → 读 B/tasks.yml，不因 cwd 无文件而假绿', async () => {
      const cwdSide = createProjectFixture({
        name: 'accanchor-cwd-side',
        files: { 'tasks.yml': tasksYml(true) },
      });
      const projectSide = createProjectFixture({
        name: 'accanchor-project-side',
        files: { 'tasks.yml': tasksYml(false) },
      });
      process.chdir(cwdSide);

      const result = await acceptance({ projectPath: projectSide, taskId: 'TASK-001' }, captureIO());

      expect(result).toEqual({
        kind: 'fail',
        reason: expect.stringContaining('1 unchecked acceptance criteria'),
      });
    });

    it('--tasks-path 相对路径按 projectPath 解析，不按 cwd', async () => {
      const cwdSide = createProjectFixture({
        name: 'accanchorrel-cwd-side',
        files: { 'config/tasks.yml': tasksYml(true) },
      });
      const projectSide = createProjectFixture({
        name: 'accanchorrel-project-side',
        files: { 'config/tasks.yml': tasksYml(false) },
      });
      process.chdir(cwdSide);

      const result = await acceptance(
        { projectPath: projectSide, taskId: 'TASK-001', tasksPath: 'config/tasks.yml' },
        captureIO(),
      );

      expect(result).toEqual({
        kind: 'fail',
        reason: expect.stringContaining('1 unchecked acceptance criteria'),
      });
    });
  });

  describe('check / status（站点 3：trace 落点与读-写闭环）', () => {
    /** 在 fixture 里跑 git（argv 数组，不经 shell） */
    function git(dir: string, ...args: string[]): void {
      execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    }

    /** check 能真跑完的项目：已提交基线 + staged 改动 + 一条 pass trace（验证证据） */
    function checkProject(name: string): string {
      const dir = createProjectFixture({
        name,
        files: { 'README.md': '# fixture\n', 'src/existing.ts': 'export const a = 1;\n' },
        traces: [{ constraintId: 'fixture', result: 'pass' }],
      });
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'fixture@example.com');
      git(dir, 'config', 'user.name', 'Fixture');
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'baseline');
      fs.writeFileSync(path.join(dir, 'src/existing.ts'), 'export const a = 2;\n', 'utf-8');
      git(dir, 'add', '--', 'src/existing.ts');
      return dir;
    }

    /** trace 正本的行（按生产落点 DEFAULT_TRACE_FILE 解析，不另立路径口径） */
    function traceLinesOf(projectRoot: string): string[] {
      return fs
        .readFileSync(path.join(projectRoot, DEFAULT_TRACE_FILE), 'utf-8')
        .split('\n')
        .filter(Boolean);
    }

    it('--project-path B → trace 落 B/.harness/logs/traces.log，A 侧不长出文件', async () => {
      const cwdSide = createProjectFixture({ name: 'traceanchor-cwd' });
      const projectSide = checkProject('traceanchor-project');
      process.chdir(cwdSide);
      const seeded = traceLinesOf(projectSide).length;

      const result = await check(
        { staged: true, projectPath: projectSide, trigger: 'code_implementation' },
        captureIO()
      );
      expect(result).toEqual({ kind: 'ok' });

      const written = traceLinesOf(projectSide)
        .slice(seeded)
        .map(l => JSON.parse(l) as { constraintId: string; projectPath?: string });
      expect(written.map(t => t.constraintId)).toEqual(
        expect.arrayContaining(['no_completion_without_verification', 'no_hardcoded_credentials'])
      );
      expect(written.every(t => t.projectPath === projectSide)).toBe(true);
      // 病灶：修复前这一支落在调用方 cwd（A），B 侧 mtime 不动
      expect(fs.existsSync(path.join(cwdSide, DEFAULT_TRACE_FILE))).toBe(false);
    });

    it('读-写闭环：status --project-path B 读得到上一步 check 刚写的 trace', async () => {
      const cwdSide = createProjectFixture({ name: 'traceanchor-rw-cwd' });
      const projectSide = checkProject('traceanchor-rw-project');
      process.chdir(cwdSide);

      await check(
        { staged: true, projectPath: projectSide, trigger: 'code_implementation' },
        captureIO()
      );

      const io = captureIO();
      expect(await status({ projectPath: projectSide }, io)).toEqual({ kind: 'ok' });
      // 记录数取自 B 的正本行数：写侧漏到 A 就必然对不上（假绿），读到 A 也读不到 check 的落点
      expect(io.outText()).toContain(`记录数: ${traceLinesOf(projectSide).length} 条`);
      expect(io.outText()).toContain('no_completion_without_verification');
    });

    it('不带 --project-path 的项目内使用：落点仍是当下 cwd（存量使用者无感）', async () => {
      const projectSide = checkProject('traceanchor-nop');
      process.chdir(projectSide);
      const seeded = traceLinesOf(projectSide).length;

      const result = await check(
        { staged: true, trigger: 'code_implementation' },
        captureIO()
      );
      expect(result).toEqual({ kind: 'ok' });
      expect(traceLinesOf(projectSide).length).toBeGreaterThan(seeded);
    });
  });
});
