/**
 * core packProposal 库函数（harness#198）
 *
 * 升级提案材料打包从 CLI 命令搬上公共面：返回结构化 `{ materialPath, content }`，
 * 产物命名规律（`proposal-<id>-<yyyymmdd>.md` 于 `.harness/reports/`）收敛为本模块
 * 单一来源，消费方不再按命名约定反猜路径。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  packProposal,
  proposalMaterialPath,
  collectProposalMaterial,
  renderProposalMarkdown,
} from '../constraints/pack-proposal';
import { createProjectFixture, writeProjectTraces } from '../../test-setup/project-fixture';

const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

const APP_YML = [
  'constraints:',
  '  - id: app_no_internal_url',
  '    rule: Web code must not contain internal URLs',
  '    checker: regex-scan',
  '    params:',
  "      pattern: 'https?://10\\.'",
  '    severity: warning',
  '    message: 检测到内网地址',
  '',
].join('\n');

describe('packProposal（库面）', () => {
  it('生成产物并返回 { materialPath, content }；materialPath 与命名单一来源一致', () => {
    const root = createProjectFixture({ name: 'harness-pack-test' });

    const result = packProposal(root, 'capability_sync', { now: FIXED_NOW });

    expect(result).toBeDefined();
    expect(result!.materialPath).toBe(proposalMaterialPath(root, 'capability_sync', FIXED_NOW));
    expect(result!.materialPath).toBe(
      path.join(root, '.harness', 'reports', 'proposal-capability_sync-20260808.md')
    );
    // 落盘字节 = 返回的 content（消费方不必再读文件）
    expect(fs.readFileSync(result!.materialPath, 'utf-8')).toBe(result!.content);
    expect(result!.content).toContain('# 约束升级提案材料：capability_sync');
  });

  it('使用统计进材料（traces.log 聚合，只有计数）', () => {
    const root = createProjectFixture({ name: 'harness-pack-test' });
    writeProjectTraces(root, [
      { constraintId: 'capability_sync', result: 'pass' },
      { constraintId: 'capability_sync', result: 'fail', timestamp: 1700000002000 },
    ]);

    const result = packProposal(root, 'capability_sync', { now: FIXED_NOW });

    expect(result!.content).toContain('- total: 2');
    expect(result!.content).toContain('pass 1 / fail 1');
  });

  it('应用层约束：params 原文带出 + 脱敏标注；路径脱敏 <repoRoot>', () => {
    const root = createProjectFixture({
      name: 'harness-pack-test',
      files: { [path.join('.harness', 'constraints.yml')]: APP_YML },
    });

    const result = packProposal(root, 'app_no_internal_url', { now: FIXED_NOW });

    expect(result).toBeDefined();
    expect(result!.content).toContain('模板: `regex-scan`');
    expect(result!.content).toContain('请人工确认无应用内部信息');
    expect(result!.content).not.toContain(root);
  });

  it('未知 id → undefined，零落盘', () => {
    const root = createProjectFixture({ name: 'harness-pack-test' });

    expect(packProposal(root, 'ghost', { now: FIXED_NOW })).toBeUndefined();
    expect(fs.existsSync(path.join(root, '.harness', 'reports'))).toBe(false);
  });
});

describe('collectProposalMaterial / renderProposalMarkdown（stdout 通道的拆分面）', () => {
  it('未知 id → undefined；渲染结果与 packProposal 的 content 同口径', () => {
    const root = createProjectFixture({ name: 'harness-pack-test' });
    expect(collectProposalMaterial(root, 'ghost')).toBeUndefined();

    const material = collectProposalMaterial(root, 'capability_sync');
    expect(material).toBeDefined();
    expect(renderProposalMarkdown(material!, root, FIXED_NOW)).toBe(
      packProposal(root, 'capability_sync', { now: FIXED_NOW })!.content
    );
  });
});
