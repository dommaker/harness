/**
 * report 命令生效集口径（ADR-0033 块 3 子项 3）
 *
 * 缺口修复回归：report 此前跑内置全集（CONSTRAINTS），config.yml 禁用与
 * 应用层约束（.harness/constraints.yml）都进不了报告面。修复后 collectConstraints
 * 传 merged config（与 check.ts 同一 getMergedConstraintsConfig 入口），
 * 应用层条目进总数、违规如实上报。
 */

import { describe, it, expect } from '@jest/globals';
import * as path from 'path';
import { report } from '../report';
import { captureIO } from '../../command-contract';
import { CONSTRAINTS } from '../../../core/constraints/definitions';
import { createProjectFixture } from '../../../test-setup/project-fixture';

const BUILTIN_TOTAL = Object.keys(CONSTRAINTS).length;

/** 应用层约束：file-exists 指向一个不存在的文件（warning 级，必违规） */
const APP_YML = [
  'constraints:',
  '  - id: app_required_readme',
  '    rule: Project must keep README.app.md',
  '    checker: file-exists',
  '    params:',
  '      path: README.app.md',
  '    severity: warning',
  '    message: 缺少 README.app.md',
  '',
].join('\n');

function parseJsonReport(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  return JSON.parse(output.slice(start, end + 1));
}

describe('report 生效集口径（含应用层）', () => {
  it('应用层约束进报告：总数 +1，违规进 violations', async () => {
    const root = createProjectFixture({
      name: 'report-app-effective',
      files: { [path.join('.harness', 'constraints.yml')]: APP_YML },
    });
    const io = captureIO();

    await report({ format: 'json', projectPath: root }, io);

    const data = parseJsonReport(io.outText());
    expect(data.constraints.total).toBe(BUILTIN_TOTAL + 1);
    const ids = data.constraints.violations.map((v: { id: string }) => v.id);
    expect(ids).toContain('app_required_readme');
    expect(data.constraints.warningViolations).toBeGreaterThanOrEqual(1);
  });

  it('config.yml 禁用内置约束后总数随生效集收窄（不再报内置全集）', async () => {
    const root = createProjectFixture({
      name: 'report-app-effective',
      config: 'constraints:\n  capability_sync:\n    enabled: false\n',
    });
    const io = captureIO();

    await report({ format: 'json', projectPath: root }, io);

    const data = parseJsonReport(io.outText());
    expect(data.constraints.total).toBe(BUILTIN_TOTAL - 1);
  });
});
