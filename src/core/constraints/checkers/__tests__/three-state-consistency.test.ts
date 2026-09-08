/**
 * context_files 三态对照测试（工单 84）
 *
 * 同一组 fixture 同时跑 context_doc_sync 与 docs_freshness 两条约束，
 * 钉死 triage 裁决口径：未配置 / enabled 但无目标 → 约束 checker 一律 skip
 * （ADR-0001 存在性探测同构）；enabled 且非空 → 两条约束按同一组 dirs
 * 评估且判定一致。
 *
 * 附带 docs_freshness 评估段的行为变更钉子：enabled 但无目标 → skip，
 * 不再静默放行（此前返回 true）。
 * 项目根由 src/test-setup/project-fixture 声明式构造（回收仍走 mkdtemp-cleanup）。
 */

import { describe, it, expect } from '@jest/globals';
import { contextDocSync } from '../context-doc-sync';
import { docsFreshness } from '../docs-freshness';
import { buildCheckEnv } from '../types';
import { collectSourceFiles } from '../../capabilities-reconcile';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

const TABLE_HEAD = '| 模块 | 文件 | 说明 |\n|------|------|------|\n';

interface Fixture {
  configYml?: string;
  contextMdDirs?: string[];
  files?: string[];
  capabilitiesBody?: string;
}

function setupDir(name: string, fixture: Fixture = {}): string {
  return createProjectFixture({
    name: `three-state-${name}`,
    config: fixture.configYml,
    files: {
      ...Object.fromEntries((fixture.files ?? []).map(f => [f, 'export const x = 1;'])),
      ...Object.fromEntries((fixture.contextMdDirs ?? []).map(d => [`${d}/CONTEXT.md`, `# ${d}\n`])),
      ...(fixture.capabilitiesBody === undefined
        ? {}
        : { 'CAPABILITIES.md': `# Capabilities\n\n${fixture.capabilitiesBody}` }),
    },
  });
}

const CTX_FILES = (enabled: boolean, dirs?: string[]) =>
  `governance:\n  context_files:\n    enabled: ${enabled}\n` +
  (dirs ? `    required_dirs: [${dirs.map(d => `'${d}'`).join(', ')}]\n` : '');

function evalContextDocSync(dir: string) {
  const context: ConstraintContext = { operation: 'module_modification', projectPath: dir };
  return contextDocSync.evaluate(buildCheckEnv(context, 'none'));
}

function evalDocsFreshness(dir: string) {
  const context: ConstraintContext = { operation: 'file_modification', projectPath: dir };
  return docsFreshness.evaluate(
    buildCheckEnv(context, {
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: (root: string) => collectSourceFiles(dir, [root]),
    })
  );
}

/** 同一 fixture 上两条约束的判定必须一致（对照断言） */
async function expectBoth(dir: string, verdict: true | false | 'skip'): Promise<void> {
  expect(await evalContextDocSync(dir)).toBe(verdict);
  expect(await evalDocsFreshness(dir)).toBe(verdict);
}

describe('context_files 三态对照 — context_doc_sync vs docs_freshness（工单 84）', () => {
  it('未配置（无 config.yml）→ 双双 skip', async () => {
    await expectBoth(setupDir('no-config'), 'skip');
  });

  it('governance.context_files 段缺失 → 双双 skip', async () => {
    await expectBoth(setupDir('no-section', { configYml: 'preset: standard\n' }), 'skip');
  });

  it('enabled: false（约定未采用）→ 双双 skip', async () => {
    await expectBoth(setupDir('disabled', { configYml: CTX_FILES(false, ['src']) }), 'skip');
  });

  it('enabled 但 required_dirs 缺失（约定已立但无目标）→ 双双 skip', async () => {
    await expectBoth(setupDir('no-dirs', { configYml: CTX_FILES(true) }), 'skip');
  });

  it('enabled 但 required_dirs 为空数组 → 双双 skip', async () => {
    await expectBoth(setupDir('empty-dirs', { configYml: CTX_FILES(true, []) }), 'skip');
  });

  it('enabled 但 required_dirs 含非字符串项（脏配置）→ 双双 skip 而非抛错', async () => {
    await expectBoth(
      setupDir('dirty-dirs', {
        configYml: 'governance:\n  context_files:\n    enabled: true\n    required_dirs: [1, null]\n',
      }),
      'skip'
    );
  });

  it('enabled 且非空 + CONTEXT.md 齐全 → 双双 pass（同一组 dirs 同一判定）', async () => {
    await expectBoth(
      setupDir('all-present', {
        configYml: CTX_FILES(true, ['src', 'bin']),
        contextMdDirs: ['src', 'bin'],
      }),
      true
    );
  });

  it('enabled 且非空 + CONTEXT.md 缺失 → 双双 fail', async () => {
    await expectBoth(
      setupDir('missing-doc', { configYml: CTX_FILES(true, ['src', 'bin']) }),
      false
    );
  });
});

describe('docs_freshness 评估段 skip 行为变更（工单 84：约定已立但无目标不再静默放行）', () => {
  it('doc_freshness.checks 已配 + enabled 但 required_dirs 缺失 → skip（原为 true）', async () => {
    const dir = setupDir('checks-plus-empty', {
      configYml:
        'governance:\n  doc_freshness:\n    checks:\n      - type: changelog_version\n  context_files:\n    enabled: true\n',
    });
    expect(await evalDocsFreshness(dir)).toBe('skip');
  });

  it('enabled 但空 + CAPABILITIES.md 健康 → skip（原为 true）', async () => {
    const dir = setupDir('caps-healthy', {
      configYml: CTX_FILES(true),
      files: ['src/module.ts'],
      capabilitiesBody: `${TABLE_HEAD}| module | src/module.ts | module |`,
    });
    expect(await evalDocsFreshness(dir)).toBe('skip');
  });

  it('enabled 但空 + CAPABILITIES.md 幽灵条目 → 仍 fail（Step 1 文件表判定不因 context_files 受影响）', async () => {
    const dir = setupDir('caps-ghost', {
      configYml: CTX_FILES(true),
      files: ['src/old.ts'],
      capabilitiesBody: `${TABLE_HEAD}| old | src/old.ts | 活 |\n| 遗魂 | src/gone/ | 已删 |`,
    });
    expect(await evalDocsFreshness(dir)).toBe(false);
  });
});
