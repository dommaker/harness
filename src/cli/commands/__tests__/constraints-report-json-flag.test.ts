/**
 * constraints report --json-output 测试（E1 复盘修正 M3.1）
 *
 * 复现的 bug：父命令 constraints 与子命令 report 同名 --json 相撞
 * （definitions.ts 两处注册），commander 把 flag 消费在父命令上，
 * report 的 JSON 分支（constraints-report.ts）不可达——
 * `constraints report --json` 输出的仍是文本格式。
 *
 * 修法（计划允许二选一）：子命令换名 --json-output。
 * 理由：父命令 --json 有活跃消费者（studio-agent 取约束 hash），
 * 删除会静默降级其取数；子命令 --json 因本 bug 从未可达、零消费者，
 * 换名零破坏。
 *
 * 两层证据：
 * 1. 定义表不变式（无 dist 依赖）：父子命令不得注册同名 option flag
 *    （commander 会把子命令位置的同名 flag 消费在父命令上）；
 * 2. 端到端 spawn bin/harness.js（dist 存在时）：--json-output 真实到达
 *    report 的 JSON 分支，父命令 --json 行为不变。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { COMMAND_DEFINITIONS } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';

/** 从 flags 串提取长选项名：'-p, --project-path <path>' → '--project-path' */
function longFlags(flags: string): string[] {
  return [...flags.matchAll(/--[a-z][a-z-]*/g)].map(m => m[0]);
}

describe('定义表不变式：父子命令不得注册同名 option flag', () => {
  const defs = [
    ...COMMAND_DEFINITIONS,
    ...GATE_DEFINITIONS.filter(g => g.cli).map(g => g.cli!),
  ];

  it('constraints report 与父命令无同名 flag（M3.1 复现场景）', () => {
    const constraints = defs.find(d => d.command === 'constraints')!;
    const parentFlags = new Set((constraints.options ?? []).flatMap(o => longFlags(o.flags)));
    for (const child of constraints.children ?? []) {
      const childFlags = (child.options ?? []).flatMap(o => longFlags(o.flags));
      const collisions = childFlags.filter(f => parentFlags.has(f));
      expect(collisions).toEqual([]);
    }
  });

  it('全表泛化：任何带 children 的命令都与子命令 flag 不相交', () => {
    for (const def of defs) {
      if (!def.children || def.children.length === 0) continue;
      const parentFlags = new Set((def.options ?? []).flatMap(o => longFlags(o.flags)));
      for (const child of def.children) {
        const childFlags = (child.options ?? []).flatMap(o => longFlags(o.flags));
        const collisions = childFlags.filter(f => parentFlags.has(f));
        expect(collisions).toEqual([]);
      }
    }
  });
});

// dist 缺失时显式失败而非静默 skip（同 bin-exit-mapping.test.ts 口径，harness#99）
const repoRoot = path.join(__dirname, '..', '..', '..', '..');
const distBin = path.join(repoRoot, 'bin', 'harness.js');
const hasDist = fs.existsSync(path.join(repoRoot, 'dist', 'cli', 'commands'));

if (!hasDist && process.env.CI) {
  throw new Error('dist 未构建：bin 端到端 smoke 不得静默 skip —— CI 必须先 npm run build 再 npm test（harness#99）');
}

const smoke = hasDist ? describe : describe.skip;

smoke('端到端：constraints report --json-output 到达 JSON 分支', () => {
  const run = (argv: string[], cwd: string) => spawnSync(process.execPath, [distBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
  });

  it('report --json-output → stdout 是报告 JSON（含 stats），退出码 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-m31-'));
    try {
      const r = run(['constraints', 'report', '--json-output'], dir);
      expect(r.status).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(Array.isArray(report.stats)).toBe(true);
      expect(report.stats.length).toBeGreaterThan(0);
      expect(Array.isArray(report.candidates)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('父命令 constraints --json 行为不变（活跃消费者面）', () => {
    const r = run(['constraints', '--json'], repoRoot);
    expect(r.status).toBe(0);
    const meta = JSON.parse(r.stdout);
    expect(typeof meta.hash).toBe('string');
    expect(meta.counts).toBeDefined();
  });
});
