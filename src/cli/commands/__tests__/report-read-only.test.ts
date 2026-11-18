/**
 * report 命令 × read-only 策略（D3 P0.5 Phase 1）
 *
 * 真 fixture + 真 checker：应用层 exec 约束声明「写 marker 文件」命令。
 * - 普通模式：列出将执行的声明命令并执行（marker 产生），skipped=0，kind ok
 * - --read-only：命令不执行（marker 不产生），JSON/Markdown 明确标记 skipped/未执行，
 *   passed 不把未评估计成通过（假绿防线），kind 'skip'（bin 退出 0）
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { report } from '../report';
import type { ReportOptions } from '../report';
import { captureIO, type CapturingIO } from '../../command-contract';
import { createProjectFixture } from '../../../test-setup/project-fixture';

const APP_YML = (command: string): string => [
  'constraints:',
  '  - id: app_marker',
  '    rule: 写标记文件',
  '    checker: exec',
  '    params:',
  `      command: "${command.replace(/"/g, '\\"')}"`,
  '    severity: error',
  '',
].join('\n');

function projectWith(command: string): { root: string; marker: string } {
  const root = createProjectFixture({
    name: 'report-ro',
    files: { [path.join('.harness', 'constraints.yml')]: APP_YML(command) },
  });
  return { root, marker: path.join(root, 'MARKER') };
}

const markerCommand = (marker: string): string =>
  `node -e "require('fs').writeFileSync('${marker}','x')"`;

function parseJsonReport(output: string) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  return JSON.parse(output.slice(start, end + 1));
}

// 红阶段编译护栏：旧 ReportOptions 无 readOnly 字段——双转使旧实现可运行到断言失败。
const asOptions = (o: Record<string, unknown>): ReportOptions => o as unknown as ReportOptions;

describe('report × read-only（D3）', () => {
  let io: CapturingIO;
  beforeEach(() => {
    io = captureIO();
  });

  it('普通模式 JSON：列出将执行的命令并执行（marker 产生），无 skipped/skippedConstraints（形状回归）', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await report(asOptions({ format: 'json', projectPath: root }), io);
    const data = parseJsonReport(io.outText());

    expect(io.outText()).toContain('本次将执行 1 条项目声明命令');
    expect(fs.existsSync(marker)).toBe(true);
    // 普通模式 JSON 字段集合保持既有形状：read-only 新增字段必须缺席
    expect(data.constraints).not.toHaveProperty('skipped');
    expect(data.constraints).not.toHaveProperty('skippedConstraints');
    expect(result.kind).toBe('ok');
  });

  it('--read-only JSON：skipped 标记 + 原因，passed 不把未评估计成通过，kind=skip', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await report(asOptions({ format: 'json', projectPath: root, readOnly: true }), io);
    const data = parseJsonReport(io.outText());

    expect(fs.existsSync(marker)).toBe(false);
    expect(io.outText()).toContain('跳过 1 条项目声明命令');
    const skipped = data.constraints.skippedConstraints.find((s: { id: string }) => s.id === 'app_marker');
    expect(skipped).toBeDefined();
    expect(skipped.skipReason).toContain('--read-only');
    expect(data.constraints.skipped).toBeGreaterThanOrEqual(1);
    // 假绿防线：total - passed ≥ skipped（未评估不计通过）
    expect(data.constraints.total - data.constraints.passed).toBeGreaterThanOrEqual(data.constraints.skipped);
    expect(result.kind).toBe('skip');
  });

  it('--read-only Markdown：跳过行 + 跳过项小节', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await report(asOptions({ format: 'markdown', projectPath: root, readOnly: true }), io);
    const out = io.outText();

    expect(fs.existsSync(marker)).toBe(false);
    expect(out).toContain('| 跳过（未评估） |');
    expect(out).toContain('### 跳过项');
    expect(out).toContain('app_marker');
    expect(out).toContain('--read-only');
    expect(result.kind).toBe('skip');
  });

  it('普通模式 Markdown 回归：表格形状保持既有行集合（无跳过行），命令真实执行', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await report(asOptions({ format: 'markdown', projectPath: root }), io);
    const out = io.outText();

    expect(fs.existsSync(marker)).toBe(true);
    expect(out).toContain('| 指标 | 数值 |');
    // 普通模式行集合不变：read-only 新增行/小节必须缺席
    expect(out).not.toContain('| 跳过（未评估） |');
    expect(out).not.toContain('### 跳过项');
    expect(result.kind).toBe('ok');
  });
});
