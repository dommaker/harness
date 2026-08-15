/**
 * 命令注册表闭环测试（H5：命令定义即注册 + per-command 懒加载）
 *
 * - 定义表内每个实现引用（module+export）都必须可解析（构建/测试期断言，
 *   取代 commands barrel 的编译期保护——R6 消灭手工同步后的闭环兜底）
 * - definitions 是纯数据模块：require 它不加载任何命令实现（保 --help/--version 懒加载）
 * - 命令面与 CAPABILITIES.md 的 24 顶层命令一致（防误删回归）
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
  'update-user-model', 'release', 'analyze-sessions', 'constraints',
  'doc-freshness-check', 'spec-baseline-check',
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
    const refs = collectRefs(COMMAND_DEFINITIONS);
    for (const def of GATE_DEFINITIONS) {
      refs.push(def.cli.action);
      for (const entry of Object.values(def.cli.subcommands || {})) refs.push(entry);
    }
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../' + ref.module);
      if (typeof mod[ref.export] !== 'function') {
        throw new Error(`实现引用 ${ref.module}.${ref.export} 不存在或不是函数`);
      }
    }
  });

  it('顶层命令面与预期 24 命令一致（含 6 门禁）', () => {
    const names = [
      ...COMMAND_DEFINITIONS.map(d => d.command.split(' ')[0]),
      ...GATE_DEFINITIONS.map(d => d.cli.command.split(' ')[0]),
    ];
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual([...EXPECTED_TOP_LEVEL_COMMANDS].sort());
  });

  it('命令定义无重复注册名', () => {
    const names = COMMAND_DEFINITIONS.map(d => d.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it('全部命令定义的路由构造可执行（mapActionArgs/subcommands.args/optionRoutes.args/afterRun 冒烟）', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const walk = (def: CommandDefinition) => {
        if (def.mapActionArgs) {
          def.mapActionArgs(['positional'], {});
          def.mapActionArgs([], {});
        }
        for (const entry of Object.values(def.subcommands || {})) {
          if (entry.args) {
            entry.args(['positional'], {});
            entry.args([], {});
          }
        }
        for (const route of def.optionRoutes || []) {
          if (route.args) {
            route.args([], {});
            route.args(['positional'], {});
          }
        }
        if (def.afterRun) {
          def.afterRun(true, {});
          def.afterRun(false, { check: true });
        }
        for (const child of def.children || []) walk(child);
      };
      for (const def of COMMAND_DEFINITIONS) walk(def);
      // sync-docs --check 失败路径确实会请求退出
      expect(exitSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});

const repoRoot = path.join(__dirname, '..', '..', '..', '..');
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
});
