#!/usr/bin/env node

/**
 * @dommaker/harness CLI 入口
 *
 * 通用工程约束框架
 *
 * H5（#44）：命令注册表驱动生成（R6 消灭手工 commander 块 + commands/index.ts
 * 两处同步）+ per-command 懒加载（O2，拆单一 commands barrel）。
 * 本文件是纯通用引擎：命令形状（名称/别名/选项/子命令/实现引用）全部来自
 * COMMAND_DEFINITIONS（非门禁命令）与 GATE_DEFINITIONS.cli（6 门禁命令，
 * 形状同为 CommandDefinition，ADR-0007），不含任何单命令知识；
 * 新增命令 = 命令文件 + 定义表一条 + 测试，不再改本文件。
 *
 * 架构评审候选7：本文件是**全仓唯一的退出码出口**。命令实现返回 CommandResult
 * （{ kind, reason? }），此处按 kind 做唯一映射（ok/skip → 0，fail/usage-error → 1）；
 * 命令实现与定义表内不得出现 process.exit / process.exitCode。
 */

const { Command } = require('commander');
const { version } = require('../package.json');

/**
 * kind → 对外退出码（历史面只有 0/1；语义进类型，码值映射只在这一处）。
 * 未知/缺失 kind = 命令契约违规 → fail-closed。
 */
function exitCodeFor(result) {
  switch (result && result.kind) {
    case 'ok':
    case 'skip':
      return 0;
    case 'fail':
    case 'usage-error':
      return 1;
    default:
      console.error(`[harness] 命令返回了未知判定结果（期望 kind ok/skip/fail/usage-error）: ${JSON.stringify(result)}`);
      return 1;
  }
}

/**
 * 把命令判定映射到进程退出码。
 * 0 不退出（沿用进程自然退出，保持 stdout 冲刷行为不变）；非 0 立即退出
 * （与历史各命令自身的 process.exit 行为一致：首败即停）。
 */
function applyResult(result) {
  const code = exitCodeFor(result);
  if (code !== 0) process.exit(code);
  return code;
}

/**
 * per-command 懒加载（O2）：按定义表中的 module+export 引用，只在 action
 * 执行时 require 对应命令模块——任一命令执行不再经单一 barrel 加载全部命令实现。
 */
function loadImpl(ref) {
  const mod = require('../dist/cli/commands/' + ref.module);
  const fn = mod[ref.export];
  if (typeof fn !== 'function') {
    throw new Error(
      `[harness] 命令实现 "${ref.export}" 在 dist/cli/commands/${ref.module} 中不存在或不是函数。`
    );
  }
  return fn;
}

function callImpl(ref, args = []) {
  return loadImpl(ref)(...args);
}

/** 位置参数个数（'[a] [b]' → 2；无声明 → 0） */
function positionalCount(argument) {
  if (!argument) return 0;
  const matches = argument.match(/\[[^\]]+\]|<[^>]+>/g);
  return matches ? matches.length : 0;
}

/**
 * 定义表 → commander 命令树（递归处理 children，如 constraints report/retire）
 */
function buildCommand(parent, def) {
  const command = parent.command(def.command + (def.argument ? ' ' + def.argument : ''));
  command.description(def.description);
  if (def.alias) command.alias(def.alias);
  for (const opt of def.options) {
    if (opt.defaultValue !== undefined) {
      command.option(opt.flags, opt.description, opt.defaultValue);
    } else {
      command.option(opt.flags, opt.description);
    }
  }

  const argCount = positionalCount(def.argument);
  command.action(async (...args) => {
    // commander：有位置参数时 [p1..pN（缺失为 null）, options, command]；
    // 无位置参数时 [options, command]
    const positionals = argCount > 0
      ? args.slice(0, argCount).map(p => (p === null ? undefined : p))
      : [];
    const options = argCount > 0 ? args[argCount] : args[0];
    await runDefinition(command, def, positionals, options);
  });

  for (const child of def.children || []) {
    buildCommand(command, child);
  }
}

/**
 * 子命令解析：主名直查，别名表遍历匹配（候选7：别名是数据，不再复印条目）
 */
function resolveSubcommand(subcommands, name) {
  if (subcommands[name]) return subcommands[name];
  for (const entry of Object.values(subcommands)) {
    if (entry.aliases && entry.aliases.includes(name)) return entry;
  }
  return null;
}

/**
 * 执行一条命令定义：
 * 1. optionRoutes（选项条件路由，全部匹配项按序执行，替代默认 action）
 * 2. subcommands（位置参数首值路由，含别名；strict 下未知值报错退出）
 * 3. 默认 action
 * 每条路由/子命令/action 的返回值都经 applyResult 映射退出码（首败即停，
 * 与历史命令自身 process.exit 的截断行为一致）。
 */
async function runDefinition(command, def, positionals, options) {
  if (def.optionRoutes) {
    const matched = def.optionRoutes.filter(r => options[r.flag] === r.when);
    if (matched.length > 0) {
      for (const route of matched) {
        applyResult(await callImpl(route.impl, [options]));
      }
      return;
    }
  }

  if (def.subcommands) {
    const sub = positionals[0];
    if (sub != null) {
      const entry = resolveSubcommand(def.subcommands, sub);
      if (entry) {
        const callArgs = entry.withPositionals
          ? [positionals.slice(1), options]
          : [options];
        applyResult(await callImpl(entry.impl, callArgs));
        return;
      }
      if (def.subcommandStrict !== false) {
        console.error(`未知子命令: ${sub}`);
        applyResult({ kind: 'usage-error', reason: `未知子命令: ${sub}` });
        return;
      }
      // 非 strict（如 spec / 门禁命令）：未知位置参数落回默认 action
    } else if (!def.bareRunsAction) {
      // 无子命令时显示帮助（bareRunsAction 的门禁命令则落回默认 action）
      command.help();
      return;
    }
  }

  if (!def.action) {
    command.help();
    return;
  }
  applyResult(await callImpl(def.action, def.mapActionArgs ? def.mapActionArgs(positionals, options) : [options]));
}

/**
 * 构建命令树并解析。定义表在此处才 require（纯数据模块，保持 --help/--version
 * 零命令实现加载）；被 require 时（bin 侧退出码映射测试）不触发解析。
 */
function main() {
  const { COMMAND_DEFINITIONS } = require('../dist/cli/commands/definitions');
  const { GATE_DEFINITIONS } = require('../dist/gates/definitions');

  const program = new Command();

  program
    .name('harness')
    .description('通用工程约束框架 - 铁律系统、检查点验证、测试门控、执行追踪')
    .version(version);

  // ========================================
  // 全部命令：注册表驱动生成（非门禁 COMMAND_DEFINITIONS + 门禁 GATE_DEFINITIONS.cli，
  // 形状同为 CommandDefinition，ADR-0007）
  // ========================================
  for (const def of [
    ...COMMAND_DEFINITIONS,
    ...GATE_DEFINITIONS.filter(g => g.cli).map(g => g.cli),
  ]) {
    buildCommand(program, def);
  }

  // 解析命令行参数
  program.parse();
}

if (require.main === module) {
  main();
}

module.exports = { exitCodeFor, applyResult };
