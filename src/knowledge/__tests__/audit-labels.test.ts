/**
 * 审计规则 label 闭环测试（架构评审 A6，#109）
 *
 * label 正本在规则定义上（定义即注册，#134 后随规则表住在 audit-scoring.ts），
 * AUDIT_RULE_LABELS 派生自规则表。新增规则无 label → 编译期/本测试期即失败，
 * CLI 不再静默回落英文键名。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KnowledgeAudit } from '../audit';
import { AUDIT_RULE_LABELS } from '../audit-scoring';
import type { AuditRuleName } from '../audit-scoring';
import { FileKnowledgeStore } from '../store';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-labels-test-'));
}

describe('AUDIT_RULE_LABELS', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('应与运行期 summary 的规则键集完全一致（双向闭环）', () => {
    const report = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: tmpDir })).run();
    const summaryKeys = Object.keys(report.summary).sort();
    const labelKeys = (Object.keys(AUDIT_RULE_LABELS) as AuditRuleName[]).sort();
    expect(labelKeys).toEqual(summaryKeys);
  });

  it('每条规则都有非空中文 label，event-noise / deprecated-domain 不再缺失', () => {
    for (const [rule, label] of Object.entries(AUDIT_RULE_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toBe(rule); // 不允许回落英文键名
    }
    expect(AUDIT_RULE_LABELS['event-noise']).toBe('运维事件噪音');
    expect(AUDIT_RULE_LABELS['deprecated-domain']).toBe('废弃领域残留');
  });
});
