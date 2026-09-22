/**
 * 填空式 checker 模板（regex-scan / file-exists）测试（ADR-0033 块 3 子项 2）
 *
 * 范式同 capability-sync.test.ts：测面是 ConstraintCheck.evaluate(env)，
 * 证据经 buildCheckEnv 的 EvidenceProviders stub 注入，项目根用 createProjectFixture。
 * 另覆盖 validateParams 各分支（加载期校验由 app-constraints-loader 套件钉住，
 * 此处钉模板自身的参数口径）。
 */

import { describe, it, expect } from '@jest/globals';
import { regexScan } from '../templated/regex-scan';
import { fileExists } from '../templated/file-exists';
import { TEMPLATES } from '../index';
import { buildCheckEnv, normalizeCheckOutcome, type CheckEnv, type CheckOutcome } from '../types';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

/** 证据 stub：staged diff / 变更清单由用例注入 */
function makeEnv(
  projectPath: string,
  opts: { diff?: string; changedFiles?: string[] } = {}
): CheckEnv {
  const context: ConstraintContext = {
    operation: 'commit',
    projectPath,
    changedFiles: opts.changedFiles ?? [],
  };
  return buildCheckEnv(context, {
    stagedDiff: async () => opts.diff ?? '',
    stagedDiffNames: async () => (opts.changedFiles ?? []).join('\n'),
    srcScan: () => [],
  });
}

const passed = (outcome: CheckOutcome): boolean => normalizeCheckOutcome(outcome).satisfied;
const evidenceText = (outcome: CheckOutcome): string =>
  normalizeCheckOutcome(outcome).evidence.join('\n');

const DIFF_WITH_HIT = [
  'diff --git a/apps/web/src/api.ts b/apps/web/src/api.ts',
  '--- a/apps/web/src/api.ts',
  '+++ b/apps/web/src/api.ts',
  '@@ -1,2 +1,3 @@',
  ' const x = 1;',
  '+const base = "http://10.0.1.8:8080";',
  '-const old = 2;',
].join('\n');

describe('regex-scan 模板注册与参数校验', () => {
  it('已注册进 TEMPLATES', () => {
    expect(TEMPLATES.get('regex-scan')).toBe(regexScan);
    expect(TEMPLATES.get('file-exists')).toBe(fileExists);
  });

  it('validateParams：pattern 必填且须为合法正则', () => {
    expect(regexScan.validateParams({})).not.toEqual([]);
    expect(regexScan.validateParams({ pattern: 1 }).join()).toContain('pattern');
    expect(regexScan.validateParams({ pattern: '([' }).join()).toContain('合法正则');
    expect(regexScan.validateParams({ pattern: 'ok' })).toEqual([]);
  });

  it('validateParams：glob 须为字符串，scope 只收 diff/content', () => {
    expect(regexScan.validateParams({ pattern: 'x', glob: 1 }).join()).toContain('glob');
    expect(regexScan.validateParams({ pattern: 'x', scope: 'all' }).join()).toContain('scope');
    expect(regexScan.validateParams({ pattern: 'x', glob: 'src/**', scope: 'content' })).toEqual([]);
  });
});

describe('regex-scan evaluate（scope=diff 缺省）', () => {
  const check = regexScan.create('app_no_internal_url', { pattern: 'https?://10\\.' });

  it('staged diff 新增行命中 → 违规，证据点名文件与命中行', async () => {
    const dir = createProjectFixture({ name: 'regex-scan-diff' });
    const outcome = await check.evaluate(makeEnv(dir, { diff: DIFF_WITH_HIT }));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('apps/web/src/api.ts');
    expect(evidenceText(outcome)).toContain('http://10.0.1.8:8080');
  });

  it('删除行（- 前缀）不算命中', async () => {
    const dir = createProjectFixture({ name: 'regex-scan-diff' });
    const diff = DIFF_WITH_HIT.replace('+const base', '-const base');
    expect(passed(await check.evaluate(makeEnv(dir, { diff })))).toBe(true);
  });

  it('未命中 → 通过', async () => {
    const dir = createProjectFixture({ name: 'regex-scan-diff' });
    const diff = 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+const ok = 1;';
    expect(passed(await check.evaluate(makeEnv(dir, { diff })))).toBe(true);
  });

  it('glob 限定文件集：命中文件在 glob 外 → 通过', async () => {
    const scoped = regexScan.create('app_scoped', { pattern: 'https?://10\\.', glob: 'apps/app/**' });
    const dir = createProjectFixture({ name: 'regex-scan-diff' });
    expect(passed(await scoped.evaluate(makeEnv(dir, { diff: DIFF_WITH_HIT })))).toBe(true);
  });

  it('diff 为空 → 退化变更文件内容扫描', async () => {
    const dir = createProjectFixture({
      name: 'regex-scan-content',
      files: { 'src/conf.ts': 'export const u = "http://10.9.9.9";' },
    });
    const outcome = await check.evaluate(makeEnv(dir, { changedFiles: ['src/conf.ts'] }));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('src/conf.ts');
  });

  it('scope=content：不看 diff，直接扫变更文件内容', async () => {
    const contentCheck = regexScan.create('app_content', { pattern: 'https?://10\\.', scope: 'content' });
    const dir = createProjectFixture({ name: 'regex-scan-content' });
    // diff 里有命中但 scope=content 且 changedFiles 为空 → 通过
    expect(passed(await contentCheck.evaluate(makeEnv(dir, { diff: DIFF_WITH_HIT })))).toBe(true);
  });
});

describe('file-exists 参数校验', () => {
  it('path 或 glob 至少填一个；mustExist 须为布尔', () => {
    expect(fileExists.validateParams({}).join()).toContain('至少填一个');
    expect(fileExists.validateParams({ path: 1 }).join()).toContain('path');
    expect(fileExists.validateParams({ path: 'a', mustExist: 'yes' }).join()).toContain('mustExist');
    expect(fileExists.validateParams({ path: 'a' })).toEqual([]);
    expect(fileExists.validateParams({ glob: 'docs/**' })).toEqual([]);
  });
});

describe('file-exists evaluate', () => {
  it('path 存在 → 通过；不存在 → 违规且证据点名', async () => {
    const dir = createProjectFixture({ name: 'file-exists', files: { 'AGENTS.md': '# a' } });
    const check = fileExists.create('app_agents_md', { path: 'AGENTS.md' });
    expect(passed(await check.evaluate(makeEnv(dir)))).toBe(true);

    const missing = fileExists.create('app_missing', { path: 'AGENTS.md' });
    const empty = createProjectFixture({ name: 'file-exists-empty' });
    const outcome = await missing.evaluate(makeEnv(empty));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('AGENTS.md');
  });

  it('glob 有匹配 → 通过；无匹配 → 违规', async () => {
    const dir = createProjectFixture({ name: 'file-exists', files: { 'docs/a/x.md': 'x' } });
    const check = fileExists.create('app_docs', { glob: 'docs/**/*.md' });
    expect(passed(await check.evaluate(makeEnv(dir)))).toBe(true);

    const empty = createProjectFixture({ name: 'file-exists-empty' });
    const outcome = await check.evaluate(makeEnv(empty));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('docs/**/*.md');
  });

  it('path 与 glob 都填 = 两者都要满足', async () => {
    const dir = createProjectFixture({ name: 'file-exists', files: { 'AGENTS.md': '# a' } });
    const check = fileExists.create('app_both', { path: 'AGENTS.md', glob: 'docs/**' });
    const outcome = await check.evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('docs/**');
  });

  it('mustExist=false：存在 → 违规且证据点名；不存在 → 通过', async () => {
    const withFile = createProjectFixture({ name: 'file-exists', files: { '.env.local': 'x' } });
    const check = fileExists.create('app_no_env_local', { path: '.env.local', mustExist: false });
    const outcome = await check.evaluate(makeEnv(withFile));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('.env.local');

    const clean = createProjectFixture({ name: 'file-exists-empty' });
    expect(passed(await check.evaluate(makeEnv(clean)))).toBe(true);
  });

  it('mustExist=false + glob：命中文件逐条进证据', async () => {
    const dir = createProjectFixture({
      name: 'file-exists',
      files: { 'dist/a.js': 'x', 'dist/b.js': 'y' },
    });
    const check = fileExists.create('app_no_dist', { glob: 'dist/**', mustExist: false });
    const outcome = await check.evaluate(makeEnv(dir));
    expect(passed(outcome)).toBe(false);
    expect(evidenceText(outcome)).toContain('dist/a.js');
    expect(evidenceText(outcome)).toContain('dist/b.js');
  });
});
