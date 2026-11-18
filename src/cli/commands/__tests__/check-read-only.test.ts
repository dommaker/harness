/**
 * check 命令 × read-only 策略（D3 P0.5 Phase 1）
 *
 * 真 fixture + 真 checker 全链：应用层 exec 约束声明「写 marker 文件」命令。
 * - 普通模式：运行前列出将执行的声明命令，命令照常执行（marker 产生），kind ok
 * - --read-only：命令不执行（marker 不产生），未评估条目明确列出，
 *   不产生「已检查」假绿 → kind 'skip'（bin 退出 0）
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { check } from '../check';
import type { CheckOptions } from '../check';
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
    name: 'check-ro',
    files: { [path.join('.harness', 'constraints.yml')]: APP_YML(command) },
  });
  return { root, marker: path.join(root, 'MARKER') };
}

const markerCommand = (marker: string): string =>
  `node -e "require('fs').writeFileSync('${marker}','x')"`;

// 红阶段编译护栏：options 字面量带 readOnly，旧 CheckOptions 无此字段——
// 双转使旧实现可运行到断言失败（红 = 运行时断言，不只是编译期）。
const asOptions = (o: Record<string, unknown>): CheckOptions => o as unknown as CheckOptions;

describe('check × read-only（D3）', () => {
  let io: CapturingIO;
  beforeEach(() => {
    io = captureIO();
  });

  it('普通模式：运行前列出将执行的声明命令，默认仍执行', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await check(asOptions({ staged: false, projectPath: root, readOnly: false }), io);
    const out = io.outText();

    expect(out).toContain('本次将执行 1 条项目声明命令');
    expect(out).toContain('writeFileSync');
    expect(fs.existsSync(marker)).toBe(true);
    expect(result.kind).toBe('ok');
  });

  it('--read-only：命令不执行（marker 不产生），未评估明确列出，kind=skip 不假绿', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await check(asOptions({ staged: false, projectPath: root, readOnly: true }), io);
    const out = io.outText();

    expect(fs.existsSync(marker)).toBe(false);
    // 跳过清单点名 + 原因
    expect(out).toContain('跳过评估');
    expect(out).toContain('app_marker');
    expect(out).toContain('--read-only');
    // 不打「✅ 约束检查通过」结论行（假绿防线）
    expect(out).not.toContain('✅ 约束检查通过');
    expect(result.kind).toBe('skip');
  });

  it('无声明命令的项目：清单零噪声，read-only 也不改 kind', async () => {
    const root = createProjectFixture({ name: 'check-ro-empty' });
    const result = await check(asOptions({ staged: false, projectPath: root, readOnly: true }), io);
    const out = io.outText();

    expect(out).not.toContain('项目声明命令');
    expect(result.kind).toBe('ok');
  });

  it('清单与分发同口径：trigger 不匹配的 exec 约束不进清单也不执行', async () => {
    const root = createProjectFixture({
      name: 'check-ro-trigger',
      files: {
        [path.join('.harness', 'constraints.yml')]: [
          'constraints:',
          '  - id: app_match',
          '    rule: 恒评估写 MARKER',
          '    checker: exec',
          '    params:',
          `      command: "${markerCommand('MARKER').replace(/"/g, '\\"')}"`,
          '    severity: error',
          '  - id: app_nomatch',
          '    rule: trigger 不命中，不得进清单',
          '    checker: exec',
          '    trigger: not_a_real_operation',
          '    params:',
          `      command: "${markerCommand('NOPE-MARKER').replace(/"/g, '\\"')}"`,
          '    severity: error',
          '',
        ].join('\n'),
      },
    });
    const result = await check(asOptions({ staged: false, projectPath: root }), io);
    const out = io.outText();

    // 清单只含本次真正会分发的 app_match（与 matchesTrigger 同口径）
    expect(out).toContain('本次将执行 1 条项目声明命令');
    expect(out).not.toContain('NOPE-MARKER');
    // 未分发 = 未执行
    expect(fs.existsSync(path.join(root, 'MARKER'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'NOPE-MARKER'))).toBe(false);
    expect(result.kind).toBe('ok');
  });
});
