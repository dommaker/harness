/**
 * validate 命令 × read-only 策略（D3 P0.5 Phase 1）
 *
 * 真 fixture + 真 CheckpointValidator：检查点声明「写 marker 文件」命令。
 * - 普通模式：运行前列出将执行的声明命令，命令照常执行（marker 产生），kind ok
 * - --read-only：命令不执行（marker 不产生），检查点「跳过评估」明确列出，
 *   无失败但有跳过时 kind 'skip'（bin 退出 0）而非 ok——不把跳过当验证通过
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { validate } from '../validate';
import type { ValidateOptions } from '../validate';
import { captureIO, type CapturingIO } from '../../command-contract';
import { createProjectFixture } from '../../../test-setup/project-fixture';

const CHECKPOINTS_YML = (command: string): string => [
  'checkpoints:',
  '  - id: cp-1',
  '    checks:',
  '      - id: c-1',
  '        type: command_success',
  `        config: { command: "${command.replace(/"/g, '\\"')}" }`,
  '',
].join('\n');

function projectWith(command: string): { root: string; marker: string } {
  const root = createProjectFixture({
    name: 'validate-ro',
    files: { [path.join('.harness', 'checkpoints.yml')]: CHECKPOINTS_YML(command) },
  });
  return { root, marker: path.join(root, 'MARKER') };
}

const markerCommand = (marker: string): string =>
  `node -e "require('fs').writeFileSync('${marker}','x')"`;

// 红阶段编译护栏：旧 ValidateOptions 无 readOnly 字段——双转使旧实现可运行到断言失败。
const asOptions = (o: Record<string, unknown>): ValidateOptions => o as unknown as ValidateOptions;

describe('validate × read-only（D3）', () => {
  let io: CapturingIO;
  beforeEach(() => {
    io = captureIO();
  });

  it('普通模式：运行前列出将执行的声明命令，默认仍执行', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await validate(asOptions({ projectPath: root }), io);
    const out = io.outText();

    expect(out).toContain('本次将执行 1 条项目声明命令');
    expect(out).toContain('writeFileSync');
    expect(fs.existsSync(marker)).toBe(true);
    expect(result).toEqual({ kind: 'ok' });
  });

  it('--read-only：命令不执行（marker 不产生），检查点跳过评估明确列出，kind=skip', async () => {
    const { root, marker } = projectWith(markerCommand('MARKER'));
    const result = await validate(asOptions({ projectPath: root, readOnly: true }), io);
    const out = io.outText();

    expect(fs.existsSync(marker)).toBe(false);
    expect(out).toContain('跳过评估');
    expect(out).toContain('cp-1');
    expect(out).toContain('--read-only');
    // 不把跳过当通过：不出「所有检查点验证通过」
    expect(out).not.toContain('所有检查点验证通过');
    expect(result.kind).toBe('skip');
  });

  it('read-only 混合（真实失败 + 命令跳过）：失败仍 fail，跳过明细与原因可见且不计失败', async () => {
    const root = createProjectFixture({
      name: 'validate-ro-fail',
      files: {
        [path.join('.harness', 'checkpoints.yml')]: [
          'checkpoints:',
          '  - id: cp-1',
          '    checks:',
          '      - id: c-1',
          '        type: file_exists',
          '        config: { path: not-there.txt }',
          '      - id: c-2',
          '        type: command_success',
          '        config: { command: \'node -e "process.exit(1)"\' }',
          '',
        ].join('\n'),
      },
    });
    const result = await validate(asOptions({ projectPath: root, readOnly: true }), io);
    const out = io.outText();

    // 真实失败照旧红色可见、驱动 fail 退出
    expect(out).toContain('❌ cp-1: 失败');
    expect(out).toContain('not-there.txt');
    expect(result.kind).toBe('fail');
    expect(result.kind === 'fail' && result.reason).toContain('cp-1');

    // 同检查点的命令跳过不以红色失败出现，跳过原因（--read-only）必须随该 check 的明细行可见
    // （--read-only 也出现在运行前清单头上，所以钉「同一行」而不是「输出任意处」）
    const c2Lines = out.split('\n').filter(line => line.includes('c-2'));
    expect(c2Lines.length).toBeGreaterThan(0);
    expect(c2Lines.some(line => line.includes('--read-only'))).toBe(true);
    expect(c2Lines.some(line => line.includes('跳过检查（命令未执行）'))).toBe(true);
  });
});
