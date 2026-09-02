/**
 * capability_sync 检查器旁测（ADR-0009 / 架构评审候选4）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：证据经 EvidenceProviders 注入，
 * 不再绕 engine facade（checker.check）与真实 git staging。
 * 自 checker-extra.test.ts 迁入并改写驱动方式；断言语义逐条保持。
 * 临时目录由 src/test-setup/mkdtemp-cleanup.ts 统一回收。
 */

import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { capabilitySync } from '../capability-sync';
import { buildCheckEnv, type CheckEnv } from '../types';
import { collectSourceFiles } from '../../capabilities-reconcile';
import type { ConstraintContext } from '../../../../types/constraint';

const TABLE_HEAD = '| 模块 | 文件 | 说明 |\n|------|------|------|\n';

function setupDir(
  name: string,
  capContent: string,
  files: string[] = [],
  mode?: 'file' | 'module'
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cap-sync-${name}-`));
  if (mode) {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness', 'config.yml'),
      `governance:\n  capabilities:\n    mode: ${mode}\n`
    );
  }
  fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), capContent);
  for (const f of files) {
    const fp = path.join(dir, f);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, 'export const x = 1;');
  }
  return dir;
}

/** stub staged 清单；srcScan 缺省走真实 fs（与被检文件一致），传 scan 则按根覆写 */
function makeEnv(
  projectPath: string,
  staged: string[],
  scan?: Record<string, string[]>
): CheckEnv {
  const context: ConstraintContext = { operation: 'commit', projectPath };
  return buildCheckEnv(context, {
    stagedDiff: async () => '',
    stagedDiffNames: async () => staged.join('\n'),
    srcScan: (root: string) =>
      scan ? scan[root] ?? [] : collectSourceFiles(projectPath, [root]),
  });
}

describe('capability_sync — skip 与文档格式门槛', () => {
  it('无 CAPABILITIES.md → skip（ADR-0001 存在性探测，有无变更都一样）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-sync-none-'));
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe('skip');
    expect(await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe('skip');
  });

  it('散文文档（无表格）+ 有变更 → 放行（历史语义）', async () => {
    const dir = setupDir('prose', '# Capabilities\n\n- Feature: test', ['feature.ts']);
    expect(await capabilitySync.evaluate(makeEnv(dir, ['feature.ts']))).toBe(true);
  });

  it('清单格式（计数行）→ 放行，计数由 sync-docs 维护', async () => {
    const dir = setupDir('listing', '# Capabilities\n\n## CLI Commands (25)\ncheck, validate\n');
    expect(await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe(true);
  });

  it('有表格但零条目 + 有变更 → 不得放行', async () => {
    const dir = setupDir('empty-table', `# Capabilities\n\n${TABLE_HEAD}`);
    expect(await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe(false);
  });

  it('有表格但零条目 + 源码有文件 → step2 不得放行', async () => {
    const dir = setupDir('empty-table-scan', `# Capabilities\n\n${TABLE_HEAD}`, ['src/foo.ts']);
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(false);
  });
});

describe('capability_sync — step1 增量覆盖', () => {
  const run = (dir: string, staged: string[]) =>
    capabilitySync.evaluate(makeEnv(dir, staged, {}));

  it('变更文件未被登记 → 失败', async () => {
    const dir = setupDir('step1-uncovered', `# C\n\n${TABLE_HEAD}| 旧 | old/module.ts | 旧 |\n`);
    expect(await run(dir, ['new-module.ts'])).toBe(false);
  });

  it('变更文件按登记路径覆盖 → 通过', async () => {
    const dir = setupDir('step1-covered', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(await run(dir, ['src/foo.ts'])).toBe(true);
  });

  it('每个变更文件都必须被覆盖（every 而非 some）', async () => {
    const dir = setupDir('step1-every', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(await run(dir, ['src/foo.ts', 'scripts/bar.ts'])).toBe(false);
  });

  it('后缀碰撞不覆盖：xfoo.ts 不被 foo.ts 条目覆盖', async () => {
    const dir = setupDir('step1-endswith', `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`);
    expect(await run(dir, ['web/xfoo.ts'])).toBe(false);
  });

  it('子串误配不覆盖：docs/src/foo.tsx 不被 src/foo.ts 条目覆盖', async () => {
    const dir = setupDir('step1-includes', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(await run(dir, ['docs/src/foo.tsx'])).toBe(false);
  });

  it('basename 条目按路径边界后缀覆盖（src/foo.ts 被 foo.ts 覆盖）', async () => {
    const dir = setupDir('step1-suffix-ok', `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`);
    expect(await run(dir, ['src/foo.ts'])).toBe(true);
  });

  it('测试文件与非代码变更不参与 step1', async () => {
    const dir = setupDir('step1-noncode', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(
      await run(dir, ['src/__tests__/foo.test.ts', 'docs/readme.md', 'package.json'])
    ).toBe(true);
  });
});

describe('capability_sync — step2 全量覆盖（file 模式）', () => {
  it('全部源文件已登记 → 通过', async () => {
    const dir = setupDir(
      'step2-ok',
      `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(true);
  });

  it('有未登记源文件 → 失败', async () => {
    const dir = setupDir(
      'step2-missing',
      `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`,
      ['src/foo.ts', 'src/unlisted.ts']
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(false);
  });

  it('basename 条目同样按边界后缀覆盖 step2（step1/step2 语义一致）', async () => {
    const dir = setupDir(
      'step2-basename',
      `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(true);
  });

  it('不同路径同后缀文件不被误覆盖（lib/foo.ts 不覆盖 src/foo.ts）', async () => {
    const dir = setupDir(
      'step2-boundary',
      `# C\n\n${TABLE_HEAD}| foo | lib/foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(false);
  });
});

describe('capability_sync — module 模式（未覆盖聚合为目录形状）', () => {
  it('目录条目覆盖源文件 → 通过', async () => {
    const dir = setupDir(
      'mod-covered',
      `# C\n\n${TABLE_HEAD}| 核心 | src/core/ | 核心 |\n`,
      ['src/core/foo.ts', 'src/core/bar.ts'],
      'module'
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(true);
  });

  it('文件条目精确匹配也算覆盖', async () => {
    const dir = setupDir(
      'mod-file-entry',
      `# C\n\n${TABLE_HEAD}| foo | src/core/foo.ts | foo |\n`,
      ['src/core/foo.ts'],
      'module'
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(true);
  });

  it('新目录未登记 → 失败', async () => {
    const dir = setupDir(
      'mod-uncovered',
      `# C\n\n${TABLE_HEAD}| 核心 | src/core/ | 核心 |\n`,
      ['src/core/foo.ts', 'src/newdir/bar.ts'],
      'module'
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(false);
  });

  it('module 模式文件条目按边界后缀覆盖（step1/step2 同规则）', async () => {
    const dir = setupDir(
      'mod-suffix',
      `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`,
      ['src/foo.ts'],
      'module'
    );
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe(true);
  });
});

describe('capability_sync — fail-open 可观测', () => {
  it('证据读取异常时放行但输出 warn', async () => {
    const dir = setupDir('failopen', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const env: CheckEnv = {
      ...makeEnv(dir, []),
      stagedDiffNames: async () => {
        throw new Error('git boom');
      },
    };
    expect(await capabilitySync.evaluate(env)).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
