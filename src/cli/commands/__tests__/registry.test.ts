/**
 * 命令注册表闭环测试（H5：命令定义即注册 + per-command 懒加载）
 *
 * - 定义表内每个实现引用（module+export）都必须可解析（构建/测试期断言，
 *   取代 commands barrel 的编译期保护——R6 消灭手工同步后的闭环兜底）
 * - definitions 是纯数据模块：require 它不加载任何命令实现（保 --help/--version 懒加载）
 * - 命令面与 CAPABILITIES.md 的 21 顶层命令一致（防误删回归）
 * - bin/harness.js 端到端冒烟（dist 存在时）：--version/--help 零命令实现模块，
 *   单命令执行只加载该命令模块（O2 per-command 懒加载）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { COMMAND_DEFINITIONS, type CommandDefinition, type CommandImplRef } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';

function collectRefs(defs: CommandDefinition[]): CommandImplRef[] {
  const refs: CommandImplRef[] = [];
  const walk = (def: CommandDefinition) => {
    if (def.action) refs.push(def.action);
    if (def.subcommands) {
      for (const entry of Object.values(def.subcommands)) refs.push(entry.impl);
    }
    if (def.optionRoutes) {
      for (const route of def.optionRoutes) refs.push(route.impl);
    }
    for (const child of def.children || []) walk(child);
  };
  for (const def of defs) walk(def);
  return refs;
}

const EXPECTED_TOP_LEVEL_COMMANDS = [
  'check', 'validate', 'passes-gate', 'init', 'report', 'status', 'spec',
  'sync-docs', 'knowledge', 'sdd', 'failure', 'posteval-plan',
  'release', 'constraints',
  'spec-baseline-check',
  // 6 门禁命令（GATE_DEFINITIONS 驱动）
  'acceptance', 'command', 'contract', 'performance', 'review', 'security',
];

describe('命令注册表闭环', () => {
  it('definitions 是纯数据模块：加载时不引入任何命令实现', () => {
    const loaded = Object.keys(require.cache)
      .filter(k => k.includes('/cli/commands/') && k.endsWith('.ts') && !k.includes('__tests__'));
    expect(loaded).toEqual([
      expect.stringContaining('/cli/commands/definitions.ts'),
    ]);
  });

  it('全部实现引用可解析（module 存在且 export 是函数）', () => {
    const refs = collectRefs([
      ...COMMAND_DEFINITIONS,
      ...GATE_DEFINITIONS.map(d => d.cli),
    ]);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../' + ref.module);
      if (typeof mod[ref.export] !== 'function') {
        throw new Error(`实现引用 ${ref.module}.${ref.export} 不存在或不是函数`);
      }
    }
  });

  it('全部命令实现声明 CommandResult 返回（候选7：判定经返回值外溢）', () => {
    const refs = collectRefs([
      ...COMMAND_DEFINITIONS,
      ...GATE_DEFINITIONS.map(d => d.cli),
    ]);
    for (const ref of refs) {
      const file = fs.existsSync(path.join(repoCommandsDir, ref.module + '.ts'))
        ? path.join(repoCommandsDir, ref.module + '.ts')
        : path.join(repoCommandsDir, ref.module, 'index.ts');
      const source = fs.readFileSync(file, 'utf-8');
      const declAt = source.search(new RegExp(`function\\s+${ref.export}\\s*\\(`));
      expect(declAt).toBeGreaterThanOrEqual(0);
      const decl = source.slice(declAt, declAt + 900);
      expect(decl).toMatch(/\)\s*:\s*(?:Promise<)?CommandResult/);
      // bin 的调用约定：任何路由/子命令/action 至少传 options（mapActionArgs 编组）
      // → 首参不得是 io，否则 options 会被当成 io 传入（写流即崩，退出码 1）
      const params = source.slice(declAt + ref.export.length, declAt + 900);
      const firstParam = (params.slice(params.indexOf('(') + 1).match(/^\s*([A-Za-z_$][\w$]*)/) || [''])[1];
      expect(['io', '_io']).not.toContain(firstParam);
    }
  });

  it('顶层命令面与预期 21 命令一致（含 6 门禁）', () => {
    const names = [
      ...COMMAND_DEFINITIONS.map(d => d.command.split(' ')[0]),
      ...GATE_DEFINITIONS.map(d => d.cli.command.split(' ')[0]),
    ];
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([...EXPECTED_TOP_LEVEL_COMMANDS].sort());
  });

  /**
   * 文档手抄面根因闸（review A5）
   *
   * `CLAUDE.md` 的「N CLI subcommands (…)」与 `cli/commands/CONTEXT.md` 的命令清单/计数
   * 都是注册表实面的人工抄本，无闸时必然漂移：#122 机械 −2 后 CLAUDE.md 仍列着早已按
   * ADR-0009 删除的 `doc-freshness-check`，声明 22 而实面 21。三向钉死——计数等于条数、
   * 无幽灵条目、无漏列条目。
   */
  it('CLAUDE.md 与 cli/commands/CONTEXT.md 的命令抄本与定义表实面双向一致', () => {
    const actual = [
      ...COMMAND_DEFINITIONS.map(d => d.command.split(' ')[0]),
      ...GATE_DEFINITIONS.map(d => d.cli.command.split(' ')[0]),
    ].sort();

    const claudeLine = fs
      .readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8')
      .split('\n')
      .find(line => line.includes('| `src/cli/commands/` |'));
    expect(claudeLine).toBeDefined();
    const claudeMatch = (claudeLine || '').match(/(\d+) CLI subcommands \(([^)]*)\)/);
    expect(claudeMatch).toBeDefined();
    const claudeNames = claudeMatch![2]
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
      .sort();
    expect(Number(claudeMatch![1])).toBe(actual.length);
    expect(claudeNames).toEqual(actual);

    const contextDoc = fs.readFileSync(path.join(repoCommandsDir, 'CONTEXT.md'), 'utf-8');
    const contextCount = contextDoc.match(/(\d+) 个顶层命令/);
    expect(contextCount).toBeDefined();
    expect(Number(contextCount![1])).toBe(actual.length);
    const contextNames = [
      ...(contextDoc.match(/各命令文件：([^\n]+)/)?.[1] || '').split('/'),
      ...(contextDoc.match(/门禁命令实现在 ([^（]+)（/)?.[1] || '').split('/'),
    ]
      .map(name => name.replace(/`/g, '').trim())
      .filter(Boolean)
      .sort();
    expect(contextNames).toEqual(actual);
  });

  it('命令定义无重复注册名', () => {
    const names = COMMAND_DEFINITIONS.map(d => d.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it('子命令别名唯一：别名不与主名/其他别名碰撞（候选7：别名是数据，冲突即行为歧义）', () => {
    const walk = (def: CommandDefinition) => {
      const entries = Object.entries(def.subcommands || {});
      const seen = new Set<string>();
      for (const [name, entry] of entries) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
        for (const alias of entry.aliases || []) {
          expect(seen.has(alias)).toBe(false);
          seen.add(alias);
        }
      }
      for (const child of def.children || []) walk(child);
    };
    for (const def of [...COMMAND_DEFINITIONS, ...GATE_DEFINITIONS.map(d => d.cli)]) walk(def);
  });

  it('全部命令定义的路由构造可执行（mapActionArgs 冒烟；候选7 后定义表零副作用闭包）', () => {
    const walk = (def: CommandDefinition) => {
      if (def.mapActionArgs) {
        def.mapActionArgs(['positional'], {});
        def.mapActionArgs([], {});
      }
      // 候选7：定义表不得再持有退出码处理闭包（afterRun 已废除，判定进返回值）
      expect((def as unknown as Record<string, unknown>).afterRun).toBeUndefined();
      for (const child of def.children || []) walk(child);
    };
    for (const def of [
      ...COMMAND_DEFINITIONS,
      ...GATE_DEFINITIONS.map(d => d.cli),
    ]) walk(def);
  });
});

const repoRoot = path.join(__dirname, '..', '..', '..', '..');
const repoCommandsDir = path.join(repoRoot, 'src', 'cli', 'commands');
const distBin = path.join(repoRoot, 'bin', 'harness.js');
const distCommands = path.join(repoRoot, 'dist', 'cli', 'commands');
const hasDist = fs.existsSync(distCommands);

/**
 * 经 NODE_OPTIONS=--require 预加载探针 spawn bin（进程退出时打印加载的
 * 命令实现模块清单）。不用 node -e（commander 在 -e 下走 eval 分支，
 * argv 解析不同，会误判位置参数）。
 */
function runWithModuleProbe(argv: string[]): { status: number | null; implModules: string[]; stdout: string; stderr: string } {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lazy-probe-'));
  const probeFile = path.join(probeDir, 'probe.js');
  fs.writeFileSync(probeFile, [
    `process.on('exit', () => {`,
    `  const impls = Object.keys(require.cache).filter(k => /dist[\\\\/]cli[\\\\/]commands[\\\\/]/.test(k) && !/definitions\\.js/.test(k)).sort();`,
    `  console.error('IMPL_MODULES=' + impls.join(','));`,
    `});`,
  ].join('\n'));
  try {
    const r = spawnSync(process.execPath, [distBin, ...argv], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, NODE_OPTIONS: `--require ${probeFile}` },
    });
    const match = r.stderr.match(/IMPL_MODULES=(.*)/);
    return {
      status: r.status,
      implModules: match && match[1] ? match[1].split(',').filter(Boolean) : [],
      stdout: r.stdout,
      stderr: r.stderr,
    };
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

// CI 上 dist 缺失时显式失败而非静默 skip（harness#99）：bin 懒加载/路由的
// 端到端证据在下面的 smoke 块，CI 必须先 build 再 test，否则证据隐形。
if (!hasDist && process.env.CI) {
  throw new Error('dist 未构建：bin 端到端 smoke 不得静默 skip —— CI 必须先 npm run build 再 npm test（harness#99）');
}

const smoke = hasDist ? describe : describe.skip;

smoke('bin/harness.js 端到端（dist 存在时）', () => {
  it('--version：退出 0，零命令实现模块加载', () => {
    const r = runWithModuleProbe(['--version']);
    expect(r.status).toBe(0);
    expect(r.implModules).toEqual([]);
  });

  it('--help：退出 0，零命令实现模块加载', () => {
    const r = runWithModuleProbe(['--help']);
    expect(r.status).toBe(0);
    expect(r.implModules).toEqual([]);
  });

  it('harness constraints --json：只加载 constraints 命令模块', () => {
    const r = runWithModuleProbe(['constraints', '--json']);
    expect(r.status).toBe(0);
    expect(r.implModules).toEqual([
      expect.stringContaining('/dist/cli/commands/constraints.js'),
    ]);
  });

  it('harness check --list：只加载 check 命令模块（optionRoutes）', () => {
    const r = runWithModuleProbe(['check', '--list']);
    expect(r.status).toBe(0);
    expect(r.implModules).toEqual([
      expect.stringContaining('/dist/cli/commands/check.js'),
    ]);
  });

  it('harness acceptance：只加载 acceptance 命令模块（门禁注册表）', () => {
    const r = runWithModuleProbe(['acceptance', '--check-all']);
    expect(r.status).toBe(0);
    expect(r.implModules).toEqual([
      expect.stringContaining('/dist/cli/commands/acceptance.js'),
    ]);
  });

  it('未知子命令报错退出（knowledge 兜底行为保留）', () => {
    const r = runWithModuleProbe(['knowledge', 'bogus']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('未知子命令: bogus');
  });

  it('别名子命令解析到同一实现（knowledge ls = list，候选7）', () => {
    const r = runWithModuleProbe(['knowledge', 'ls', '--json']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toHaveProperty('total');
    expect(r.implModules).toEqual([
      expect.stringContaining('/dist/cli/commands/knowledge.js'),
    ]);
  });

  it('search 编组闸门随别名命令名生效且提示逐字不变（kb s 缺参 → exit 1）', () => {
    const r = runWithModuleProbe(['kb', 's']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('请提供搜索关键词');
  });
});
