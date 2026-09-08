/**
 * docs_freshness 检查器旁测（ADR-0009 / 架构评审候选4）
 *
 * 测试面 = ConstraintCheck.evaluate(env)。幽灵判定走 capabilities-reconcile：
 * 文件与目录条目都查（口径从严）；无约定文件 → skip。
 * 项目根由 src/test-setup/project-fixture 声明式构造（回收仍走 mkdtemp-cleanup）。
 */

import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { docsFreshness } from '../docs-freshness';
import { buildCheckEnv } from '../types';
import { collectSourceFiles } from '../../capabilities-reconcile';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

const TABLE_HEAD = '| 模块 | 文件 | 说明 |\n|------|------|------|\n';

function setupProject(name: string, files: string[]): string {
  return createProjectFixture({
    name: `docs-fresh-${name}`,
    files: Object.fromEntries(files.map(f => [f, 'export const x = 1;'])),
  });
}

function makeEnv(projectPath: string): ReturnType<typeof buildCheckEnv> {
  const context: ConstraintContext = { operation: 'file_modification', projectPath };
  return buildCheckEnv(context, {
    stagedDiff: async () => '',
    stagedDiffNames: async () => '',
    srcScan: (root: string) => collectSourceFiles(projectPath, [root]),
  });
}

function writeCap(dir: string, body: string): void {
  fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), `# Capabilities\n\n${body}`);
}

describe('docs_freshness — 存在性探测（ADR-0001）', () => {
  it('无 CAPABILITIES.md/CHANGELOG/配置 → skip，不计 pass/fail', async () => {
    const dir = setupProject('none', ['src/module.ts']);
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe('skip');
  });
});

describe('docs_freshness — 幽灵判定（文档→代码方向）', () => {
  it('散文文档（无表格）→ 通过', async () => {
    const dir = setupProject('no-table', []);
    writeCap(dir, 'No table here.');
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(true);
  });

  it('登记的文件全部存在 → 通过', async () => {
    const dir = setupProject('valid', ['src/old.ts', 'src/new.ts']);
    writeCap(
      dir,
      `${TABLE_HEAD}| old | src/old.ts | old |\n| new | src/new.ts | new |`
    );
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(true);
  });

  it('登记的文件已删除 → 失败并点名条目', async () => {
    const dir = setupProject('ghost-file', ['src/old.ts']);
    writeCap(
      dir,
      `${TABLE_HEAD}| old | src/old.ts | old |\n| deleted | src/deleted.ts | deleted |`
    );
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('src/deleted.ts'));
    errSpy.mockRestore();
  });

  it('登记的目录条目已消失 → 失败（ADR-0009 口径从严，文件+目录都查）', async () => {
    const dir = setupProject('ghost-dir', ['src/core/foo.ts']);
    writeCap(
      dir,
      `${TABLE_HEAD}| 核心 | src/core/ | 核心 |\n| 遗魂 | src/gone/ | 已删目录 |`
    );
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(false);
  });

  it('登记的目录条目仍存在 → 通过', async () => {
    const dir = setupProject('dir-alive', ['src/core/foo.ts']);
    writeCap(dir, `${TABLE_HEAD}| 核心 | src/core/ | 核心 |`);
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(true);
  });

  it('basename 碰撞场景：全路径幽灵即使同名文件存活仍被报出（2026-08-08 事故回归）', async () => {
    const dir = setupProject('collision', ['src/agents/routes.ts']);
    writeCap(
      dir,
      `${TABLE_HEAD}| routes | src/agents/routes.ts | 活 |\n| 旧路由 | src/agent-configs/routes.ts | 已删 |`
    );
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(false);
  });
});

describe('docs_freshness — 内置 Runner 检查（changelog/context）', () => {
  it('无 CHANGELOG 但有 CAPABILITIES.md 且条目健康 → 通过', async () => {
    const dir = setupProject('runner-ok', ['src/module.ts']);
    writeCap(dir, `${TABLE_HEAD}| module | src/module.ts | module |`);
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(true);
  });

  it('CHANGELOG 版本与 package.json 漂移 → 失败', async () => {
    const dir = setupProject('ver-drift', ['src/module.ts']);
    writeCap(dir, `${TABLE_HEAD}| module | src/module.ts | module |`);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '2.0.0' })
    );
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.0] - 2026-01-01\n\n- old\n');
    expect(await docsFreshness.evaluate(makeEnv(dir))).toBe(false);
  });
});
