/**
 * context_doc_sync 检查器旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：项目目录为真实 fs 临时目录，
 * 证据经 buildCheckEnv 注入（本检查器只用 projectPath，证据走 'none'）。
 * 自 checker-extra.test.ts 迁入并告别 engine facade；三态收紧——
 * facade 下 skip 表现为 satisfied:true，旁测直接钉 'skip'。
 * 项目根由 src/test-setup/project-fixture 声明式构造（回收仍走 mkdtemp-cleanup）。
 */

import { describe, it, expect } from '@jest/globals';
import { contextDocSync } from '../context-doc-sync';
import { buildCheckEnv } from '../types';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

function setupDir(
  name: string,
  configYml: string | null,
  contextMdDirs: string[] = []
): string {
  return createProjectFixture({
    name: `ctx-doc-sync-${name}`,
    config: configYml ?? undefined,
    files: Object.fromEntries(contextMdDirs.map(d => [`${d}/CONTEXT.md`, `# ${d}\n`])),
  });
}

function evaluate(dir: string) {
  const context: ConstraintContext = { operation: 'module_modification', projectPath: dir };
  return contextDocSync.evaluate(buildCheckEnv(context, 'none'));
}

const CTX_FILES = (enabled: boolean, dirs?: string[]) =>
  `governance:\n  context_files:\n    enabled: ${enabled}\n` +
  (dirs ? `    required_dirs: [${dirs.map(d => `'${d}'`).join(', ')}]\n` : '');

describe('context_doc_sync — skip 门槛（ADR-0001 存在性探测）', () => {
  it('无 .harness/config.yml → skip', async () => {
    expect(await evaluate(setupDir('no-config', null))).toBe('skip');
  });

  it('配置无 governance.context_files → skip', async () => {
    expect(await evaluate(setupDir('no-section', 'preset: standard\n'))).toBe('skip');
  });

  it('enabled: false → skip（facade 旧断言 satisfied:true 的真实语义）', async () => {
    expect(await evaluate(setupDir('disabled', CTX_FILES(false, ['src'])))).toBe('skip');
  });

  it('enabled 但 required_dirs 缺失/非数组/空 → skip', async () => {
    expect(await evaluate(setupDir('no-dirs', CTX_FILES(true)))).toBe('skip');
    expect(await evaluate(setupDir('empty-dirs', CTX_FILES(true, [])))).toBe('skip');
    expect(
      await evaluate(
        setupDir('bad-dirs', 'governance:\n  context_files:\n    enabled: true\n    required_dirs: src\n')
      )
    ).toBe('skip');
  });
});

describe('context_doc_sync — 判定', () => {
  it('required_dirs 全部有 CONTEXT.md → pass', async () => {
    const dir = setupDir('all-present', CTX_FILES(true, ['src', 'bin']), ['src', 'bin']);
    expect(await evaluate(dir)).toBe(true);
  });

  it('任一目录缺 CONTEXT.md → fail', async () => {
    const dir = setupDir('one-missing', CTX_FILES(true, ['src', 'bin']), ['src']);
    expect(await evaluate(dir)).toBe(false);
  });

  it('配置解析失败 → skip（不炸不报）', async () => {
    const dir = setupDir('bad-yaml', 'governance: [\n  broken: {{\n');
    expect(await evaluate(dir)).toBe('skip');
  });
});
