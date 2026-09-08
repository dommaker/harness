/**
 * -p/--project-path 锚定回归（harness#95）
 *
 * 两条门禁命令都接受 -p，但真正执行/IO 的一侧过去取 process.cwd()：不 cd 到目标工程调用，
 * 就会拿 A 工程的命令、在 B 目录跑、把证据写进 B；acceptance 的「无 tasks.yml 即跳过」
 * 本身是 passed:true，于是 -p 失效直接表现为假绿。
 *
 * 既有单测全部 mock fs/exec + 假 projectPath，恰好抹平两种取径的差异。本文件不 mock 任何 IO，
 * 前提统一为 **cwd ≠ projectPath**（cwd = A，-p = B），断言读写位置落在 B。
 * 站点 2 从两面各断言一次：CLI 命令面（`acceptance -p`）与门禁实例面（默认构造 = 注册表单例形状）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createProjectFixture } from '../../../test-setup/project-fixture';
import { SpecAcceptanceGate } from '../../../gates/acceptance';
import { captureIO } from '../../command-contract';
import { runPassesGate } from '../passes-gate';
import { acceptance } from '../acceptance';

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
    it('默认构造的门禁实例（registry / getEffectiveGates 形状）→ 读 B/tasks.yml，不读 cwd 的', async () => {
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
});
