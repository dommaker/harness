/**
 * output_* 族处理器 × read-only 策略（D3 P0.5 Phase 1）
 *
 * output_contains / output_not_contains / output_matches 在 context.output 未提供且
 * 配置 command 时会执行该命令——read-only 下必须三态 skipped 且零副作用。
 * context.output 已提供时本就不执行命令，read-only 不影响判定（不顺带改）。
 * json_path 当前不执行 command：不纳入跳过、不进清单（边界钉死）。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkOutputContains,
  checkOutputNotContains,
  checkOutputMatches,
  checkJsonPath,
} from '../check-handlers/output';
import type { CheckpointContext, OutputContentCheck, OutputMatchesCheck, JsonPathCheck } from '../../../types/checkpoint';

/** 结构化策略字面量：与 CommandExecutionPolicy 同形（不经工厂，红阶段也能编译运行） */
interface InlinePolicy {
  readOnly: boolean;
  skipReason: (command: string) => string;
  execute: (command: string, cwd: string, timeoutMs: number) => Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>;
}
const roPolicy = (): InlinePolicy => ({
  readOnly: true,
  skipReason: (command) => `--read-only：跳过命令执行（未执行）：${command}`,
  execute: async () => ({ code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false }),
});
const withPolicy = (workdir: string, policy: InlinePolicy): CheckpointContext => {
  const ctx = { workdir, projectPath: workdir } as CheckpointContext & { commandPolicy: InlinePolicy };
  ctx.commandPolicy = policy;
  return ctx;
};

const markerCommand = (marker: string): string =>
  `node -e "require('fs').writeFileSync('${marker}','x')"`;

describe('output_* 处理器 × read-only 策略', () => {
  it('output_contains read-only：三态 skipped，命令不执行（marker 不产生）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-oc-'));
    try {
      const marker = path.join(dir, 'marker');
      const check: OutputContentCheck = {
        id: 'c-1',
        type: 'output_contains',
        config: { content: 'x', command: markerCommand(marker) },
      };
      const result = await checkOutputContains(check, withPolicy(dir, roPolicy()));

      expect(result.passed).toBe(false);
      expect((result as { skipped?: boolean }).skipped).toBe(true);
      expect((result as { skipReason?: string }).skipReason).toContain('--read-only');
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('output_not_contains read-only：三态 skipped，命令不执行', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-onc-'));
    try {
      const marker = path.join(dir, 'marker');
      const check: OutputContentCheck = {
        id: 'c-2',
        type: 'output_not_contains',
        config: { content: 'x', command: markerCommand(marker) },
      };
      const result = await checkOutputNotContains(check, withPolicy(dir, roPolicy()));

      expect((result as { skipped?: boolean }).skipped).toBe(true);
      expect(result.passed).toBe(false);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('output_matches read-only：三态 skipped，命令不执行', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-om-'));
    try {
      const marker = path.join(dir, 'marker');
      const check: OutputMatchesCheck = {
        id: 'c-3',
        type: 'output_matches',
        config: { pattern: 'x+', command: markerCommand(marker) },
      };
      const result = await checkOutputMatches(check, withPolicy(dir, roPolicy()));

      expect((result as { skipped?: boolean }).skipped).toBe(true);
      expect(result.passed).toBe(false);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('context.output 已提供时 read-only 照常判定（本就不执行命令，不假跳过）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-ctxout-'));
    try {
      const check: OutputContentCheck = {
        id: 'c-4',
        type: 'output_contains',
        config: { content: 'ok', command: 'npm test' },
      };
      const ctx = withPolicy(dir, roPolicy());
      ctx.output = 'all ok';
      const result = await checkOutputContains(check, ctx);

      expect((result as { skipped?: boolean }).skipped).not.toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('json_path read-only：不执行 command 也不跳过（现状边界，未裁决不改）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-jp-'));
    try {
      const marker = path.join(dir, 'marker');
      const check: JsonPathCheck = {
        id: 'c-5',
        type: 'json_path',
        config: { jsonPath: 'a.b', expected: 1, command: markerCommand(marker) },
      };
      const ctx = withPolicy(dir, roPolicy());
      ctx.output = { a: { b: 1 } };
      const result = await checkJsonPath(check, ctx);

      expect((result as { skipped?: boolean }).skipped).not.toBe(true);
      expect(result.passed).toBe(true);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无策略（库直调默认）：output_contains 经命令执行，行为不变', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ro-oc-default-'));
    try {
      const check: OutputContentCheck = {
        id: 'c-6',
        type: 'output_contains',
        config: { content: 'hello', command: 'node -e "console.log(\'hello world\')"' },
      };
      const result = await checkOutputContains(check, { workdir: dir, projectPath: dir });

      expect((result as { skipped?: boolean }).skipped).not.toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
