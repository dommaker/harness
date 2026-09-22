/**
 * harness constraints pack-proposal 测试（ADR-0033 决策 4，块 3 子项 5）
 *
 * 覆盖：材料内容形状（条文/severity/checker/统计/升级理由留白）、路径脱敏（<repoRoot>）、
 * 应用层约束带模板 id 与 params 原文、未知 id → usage-error、--stdout、缺省落盘路径。
 *
 * 使用真实临时目录（loadAppConstraints / traces 读真实 fs）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { captureIO, type CapturingIO } from '../../command-contract';
import { constraintsPackProposal, renderProposalMarkdown } from '../constraints-pack-proposal';
import { createProjectFixture, writeProjectTraces } from '../../../test-setup/project-fixture';
import type { Constraint } from '../../../types/constraint';

const APP_YML = [
  'constraints:',
  '  - id: app_no_internal_url',
  '    rule: Web code must not contain internal URLs',
  '    checker: regex-scan',
  '    params:',
  "      pattern: 'https?://10\\.'",
  "      glob: 'apps/web/src/**'",
  '    severity: warning',
  '    message: 检测到内网地址，请改用环境变量配置',
  '',
].join('\n');

const NOW = new Date('2026-09-22T00:00:00.000Z');

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('constraintsPackProposal', () => {
  it('内置约束：材料含条文/severity/统计/升级理由留白，缺省落 .harness/reports/proposal-<id>-<YYYYMMDD>.md', async () => {
    const root = createProjectFixture({ name: 'pack-proposal-test' });
    writeProjectTraces(root, [
      { constraintId: 'no_hardcoded_credentials', result: 'pass', timestamp: 1700000000000 },
      { constraintId: 'no_hardcoded_credentials', result: 'fail', timestamp: 1700000001000 },
      { constraintId: 'no_hardcoded_credentials', result: 'skip', timestamp: 1700000002000 },
    ]);

    const result = await constraintsPackProposal('no_hardcoded_credentials', { projectPath: root, now: NOW }, io);

    expect(result.kind).toBe('ok');
    const outPath = path.join(root, '.harness', 'reports', 'proposal-no_hardcoded_credentials-20260922.md');
    expect(fs.existsSync(outPath)).toBe(true);

    const md = fs.readFileSync(outPath, 'utf-8');
    expect(md).toContain('# 约束升级提案材料：no_hardcoded_credentials');
    expect(md).toContain('- 生成日期: 2026-09-22');
    expect(md).toContain('- 来源: 内置');
    expect(md).toContain('- severity: error');
    expect(md).toContain('## 条文');
    expect(md).toContain('## checker');
    expect(md).toContain('内置定制 checker');
    // 统计：total=3，evaluated=2（skip 不计入），只有计数
    expect(md).toContain('- total: 3');
    expect(md).toContain('- evaluated: 2（pass 1 / fail 1 / skip 1）');
    expect(md).toContain('- 首次触发: 2023-11-14');
    expect(md).toContain('## 升级理由');
    expect(md).toContain('请在此填写');
    // 脱敏：材料不含项目根绝对路径
    expect(md).not.toContain(root);
  });

  it('应用层约束：checker 段带模板 id 与 params 原文 + 人工确认标注', async () => {
    const root = createProjectFixture({
      name: 'pack-proposal-test',
      files: { [path.join('.harness', 'constraints.yml')]: APP_YML },
    });

    const result = await constraintsPackProposal('app_no_internal_url', { projectPath: root, stdout: true, now: NOW }, io);

    expect(result.kind).toBe('ok');
    const out = io.outText();
    expect(out).toContain('- 来源: 应用层（.harness/constraints.yml）');
    expect(out).toContain('模板: `regex-scan`');
    expect(out).toContain('pattern:');
    expect(out).toContain('https?://10\\.');
    expect(out).toContain("glob: apps/web/src/**");
    expect(out).toContain('请人工确认无应用内部信息');
    expect(out).toContain('message: 检测到内网地址，请改用环境变量配置');
    // --stdout：不落盘
    expect(fs.existsSync(path.join(root, '.harness', 'reports'))).toBe(false);
  });

  it('路径脱敏：params/条文中出现的项目根绝对路径替换为 <repoRoot>', () => {
    const root = '/home/someone/my-app';
    const constraint: Constraint = {
      id: 'app_x',
      kind: 'check',
      rule: '不得引用 /home/someone/my-app/secrets 下的文件',
      message: 'm',
      severity: 'warning',
      trigger: [],
      enforcement: '',
      source: 'app',
      checker: 'file-exists',
      params: { path: '/home/someone/my-app/.harness/config.yml' },
    };

    const md = renderProposalMarkdown(
      { constraint, stats: { total: 0, pass: 0, fail: 0, skip: 0, evaluated: 0 } },
      root,
      NOW
    );

    expect(md).not.toContain(root);
    expect(md).toContain('<repoRoot>/secrets');
    expect(md).toContain('<repoRoot>/.harness/config.yml');
  });

  it('未知 id → usage-error，不落盘', async () => {
    const root = createProjectFixture({ name: 'pack-proposal-test' });

    const result = await constraintsPackProposal('ghost_constraint', { projectPath: root }, io);

    expect(result.kind).toBe('usage-error');
    expect(result.kind === 'usage-error' && result.reason).toContain('ghost_constraint');
    expect(io.errText()).toContain('未知约束 id');
    expect(fs.existsSync(path.join(root, '.harness', 'reports'))).toBe(false);
  });

  it('缺 id → usage-error', async () => {
    const result = await constraintsPackProposal(undefined, { projectPath: '/nonexistent' }, io);
    expect(result.kind).toBe('usage-error');
  });

  it('无 trace 时统计为零计数且不报错', async () => {
    const root = createProjectFixture({ name: 'pack-proposal-test' });

    await constraintsPackProposal('docs_freshness', { projectPath: root, stdout: true, now: NOW }, io);

    const out = io.outText();
    expect(out).toContain('- total: 0');
    expect(out).toContain('（无记录）');
  });
});
