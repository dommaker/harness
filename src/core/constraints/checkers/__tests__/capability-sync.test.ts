/**
 * capability_sync 检查器旁测（ADR-0009 / 架构评审候选4）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：证据经 EvidenceProviders 注入，
 * 不再绕 engine facade（checker.check）与真实 git staging。
 * 自 checker-extra.test.ts 迁入并改写驱动方式；断言语义逐条保持。
 * 项目根由 src/test-setup/project-fixture 声明式构造（回收仍走 mkdtemp-cleanup）。
 */

import { describe, it, expect, jest } from '@jest/globals';
import { capabilitySync } from '../capability-sync';
import { buildCheckEnv, normalizeCheckOutcome, type CheckEnv, type CheckOutcome } from '../types';
import { collectSourceFiles } from '../../capabilities-reconcile';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

const TABLE_HEAD = '| 模块 | 文件 | 说明 |\n|------|------|------|\n';

function setupDir(
  name: string,
  capContent: string,
  files: string[] = [],
  mode?: 'file' | 'module'
): string {
  return createProjectFixture({
    name: `cap-sync-${name}`,
    config: mode ? `governance:\n  capabilities:\n    mode: ${mode}\n` : undefined,
    files: {
      'CAPABILITIES.md': capContent,
      ...Object.fromEntries(files.map(f => [f, 'export const x = 1;'])),
    },
  });
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

/** 判定归一：boolean 与 CheckDetail 两种返回形状统一断言（harness#119） */
const passed = (outcome: CheckOutcome): boolean => normalizeCheckOutcome(outcome).satisfied;
/** 证据行拼成单串，便于按路径断言 */
const evidenceText = (outcome: CheckOutcome): string =>
  normalizeCheckOutcome(outcome).evidence.join('\n');

describe('capability_sync — skip 与文档格式门槛', () => {
  it('无 CAPABILITIES.md → skip（ADR-0001 存在性探测，有无变更都一样）', async () => {
    const dir = createProjectFixture({ name: 'cap-sync-none' });
    expect(await capabilitySync.evaluate(makeEnv(dir, []))).toBe('skip');
    expect(await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe('skip');
  });

  it('散文文档（无表格）+ 有变更 → 放行（历史语义）', async () => {
    const dir = setupDir('prose', '# Capabilities\n\n- Feature: test', ['feature.ts']);
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, ['feature.ts'])))).toBe(true);
  });

  it('清单格式（计数行）→ 放行，计数由 sync-docs 维护', async () => {
    const dir = setupDir('listing', '# Capabilities\n\n## CLI Commands (25)\ncheck, validate\n');
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts'])))).toBe(true);
  });

  it('有表格但零条目 + 有变更 → 不得放行（step1 拦下，证据点名变更文件）', async () => {
    const dir = setupDir('empty-table', `# Capabilities\n\n${TABLE_HEAD}`);
    const outcome = await capabilitySync.evaluate(makeEnv(dir, ['src/foo.ts']));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('src/foo.ts');
  });

  it('有表格但零条目 + 源码有文件 → 文档退化门拦下（不靠 step2 兜，harness#119）', async () => {
    const dir = setupDir('empty-table-scan', `# Capabilities\n\n${TABLE_HEAD}`, ['src/foo.ts']);
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('零条目');
  });

  it('有表格但零条目 + 源码无文件 → 放行（门限定「确有可登记对象」，不扩大 fail 面）', async () => {
    const dir = setupDir('empty-table-nosrc', `# Capabilities\n\n${TABLE_HEAD}`);
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, [])))).toBe(true);
  });
});

describe('capability_sync — step1 增量覆盖（唯一判违规处，harness#119）', () => {
  const run = (dir: string, staged: string[]) =>
    capabilitySync.evaluate(makeEnv(dir, staged, {}));

  it('变更文件未被登记 → 失败，且证据点名该文件', async () => {
    const dir = setupDir('step1-uncovered', `# C\n\n${TABLE_HEAD}| 旧 | old/module.ts | 旧 |\n`);
    const outcome = await run(dir, ['new-module.ts']);
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('new-module.ts');
  });

  it('变更文件按登记路径覆盖 → 通过', async () => {
    const dir = setupDir('step1-covered', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(passed(await run(dir, ['src/foo.ts']))).toBe(true);
  });

  it('每个变更文件都必须被覆盖（every 而非 some）', async () => {
    const dir = setupDir('step1-every', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    const outcome = await run(dir, ['src/foo.ts', 'scripts/bar.ts']);
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('scripts/bar.ts');
  });

  it('后缀碰撞不覆盖：xfoo.ts 不被 foo.ts 条目覆盖', async () => {
    const dir = setupDir('step1-endswith', `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`);
    expect(passed(await run(dir, ['web/xfoo.ts']))).toBe(false);
  });

  it('子串误配不覆盖：docs/src/foo.tsx 不被 src/foo.ts 条目覆盖', async () => {
    const dir = setupDir('step1-includes', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(passed(await run(dir, ['docs/src/foo.tsx']))).toBe(false);
  });

  it('basename 条目按路径边界后缀覆盖（src/foo.ts 被 foo.ts 覆盖）', async () => {
    const dir = setupDir('step1-suffix-ok', `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`);
    expect(passed(await run(dir, ['src/foo.ts']))).toBe(true);
  });

  it('测试文件与非代码变更不参与 step1', async () => {
    const dir = setupDir('step1-noncode', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    expect(
      passed(await run(dir, ['src/__tests__/foo.test.ts', 'docs/readme.md', 'package.json']))
    ).toBe(true);
  });
});

describe('capability_sync — step2 全量覆盖（file 模式：只提示，不判违规）', () => {
  it('全部源文件已登记 → 通过且无提示', async () => {
    const dir = setupDir(
      'step2-ok',
      `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(true);
    expect(evidenceText(outcome)).toBe('');
  });

  it('有未登记源文件 → 仍通过，但提示点名该文件（harness#119 归位）', async () => {
    const dir = setupDir(
      'step2-missing',
      `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`,
      ['src/foo.ts', 'src/unlisted.ts']
    );
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(true);
    const evidence = evidenceText(outcome);
    expect(evidence).toContain('src/unlisted.ts');
    expect(evidence).toContain('仓库级漂移');
    expect(evidence).toContain('sync-docs');
  });

  it('basename 条目同样按边界后缀覆盖 step2（step1/step2 语义一致）', async () => {
    const dir = setupDir(
      'step2-basename',
      `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, [])))).toBe(true);
  });

  it('不同路径同后缀文件不被误覆盖（lib/foo.ts 不覆盖 src/foo.ts）→ 记为漂移', async () => {
    const dir = setupDir(
      'step2-boundary',
      `# C\n\n${TABLE_HEAD}| foo | lib/foo.ts | foo |\n`,
      ['src/foo.ts']
    );
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(true);
    expect(evidenceText(outcome)).toContain('src/foo.ts');
  });

  it('step1 优先：变更未登记时判违规，证据是变更文件而非仓库漂移清单', async () => {
    const dir = setupDir(
      'step1-beats-step2',
      `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`,
      ['src/foo.ts', 'src/drifted.ts']
    );
    const outcome = await capabilitySync.evaluate(makeEnv(dir, ['src/new.ts']));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('src/new.ts');
    expect(evidenceText(outcome)).not.toContain('src/drifted.ts');
  });

  it('漂移项超过 10 个 → 证据截断并给出全量查看入口', async () => {
    const files = ['src/foo.ts', ...Array.from({ length: 12 }, (_, i) => `src/drift${i}.ts`)];
    const dir = setupDir('step2-truncate', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`, files);
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(true);
    const lines = normalizeCheckOutcome(outcome).evidence;
    expect(lines).toHaveLength(12); // 说明行 + 10 条 + 截断行
    expect(lines[lines.length - 1]).toContain('另 2 项');
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
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, [])))).toBe(true);
  });

  it('文件条目精确匹配也算覆盖', async () => {
    const dir = setupDir(
      'mod-file-entry',
      `# C\n\n${TABLE_HEAD}| foo | src/core/foo.ts | foo |\n`,
      ['src/core/foo.ts'],
      'module'
    );
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, [])))).toBe(true);
  });

  it('新目录未登记 → 不判违规，提示按目录聚合', async () => {
    const dir = setupDir(
      'mod-uncovered',
      `# C\n\n${TABLE_HEAD}| 核心 | src/core/ | 核心 |\n`,
      ['src/core/foo.ts', 'src/newdir/bar.ts'],
      'module'
    );
    const outcome = await capabilitySync.evaluate(makeEnv(dir, []));
    expect(passed(outcome)).toBe(true);
    const evidence = evidenceText(outcome);
    expect(evidence).toContain('未登记模块目录');
    expect(evidence).toContain('src/newdir/');
    expect(evidence).not.toContain('src/newdir/bar.ts');
  });

  it('module 模式文件条目按边界后缀覆盖（step1/step2 同规则）', async () => {
    const dir = setupDir(
      'mod-suffix',
      `# C\n\n${TABLE_HEAD}| foo | foo.ts | foo |\n`,
      ['src/foo.ts'],
      'module'
    );
    expect(passed(await capabilitySync.evaluate(makeEnv(dir, [])))).toBe(true);
  });
});

describe('capability_sync — fail-open 可观测', () => {
  it('证据读取异常时放行但输出 warn，且异常原因进 evidence', async () => {
    const dir = setupDir('failopen', `# C\n\n${TABLE_HEAD}| foo | src/foo.ts | foo |\n`);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const env: CheckEnv = {
      ...makeEnv(dir, []),
      stagedDiffNames: async () => {
        throw new Error('git boom');
      },
    };
    const outcome = await capabilitySync.evaluate(env);
    // fail-open 语义不变（仍不拦），但「因异常而通过」必须留痕：warn 只进本地 stderr
    expect(passed(outcome)).toBe(true);
    expect(evidenceText(outcome)).toContain('git boom');
    expect(evidenceText(outcome)).toContain('fail-open');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
