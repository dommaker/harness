#!/usr/bin/env node

/**
 * @dommaker/harness CLI 入口
 *
 * 通用工程约束框架
 *
 * H5（#44）：命令注册表驱动生成（R6 消灭手工 commander 块 + commands/index.ts
 * 两处同步）+ per-command 懒加载（O2，拆单一 commands barrel）。
 * 本文件是纯通用引擎：命令形状（名称/别名/选项/子命令/实现引用）全部来自
 * COMMAND_DEFINITIONS（非门禁命令）与 GATE_DEFINITIONS.cli（6 门禁命令），
 * 不含任何单命令知识；新增命令 = 命令文件 + 定义表一条 + 测试，不再改本文件。
 */

const { Command } = require('commander');
const { version } = require('../package.json');

/**
 * 命令定义表（纯数据模块，无实现 import），--help/--version 懒加载不受影响；
 * 门禁注册表双向闭环校验在实现加载期执行（src/gates/registry.ts），
 * 命令实现引用可解析性断言在测试期执行（src/cli/commands/__tests__/registry.test.ts）。
 */
const { COMMAND_DEFINITIONS } = require('../dist/cli/commands/definitions');
const { GATE_DEFINITIONS } = require('../dist/gates/definitions');

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
 * 执行一条命令定义：
 * 1. optionRoutes（选项条件路由，全部匹配项按序执行，替代默认 action）
 * 2. subcommands（位置参数首值路由；strict 下未知值报错退出）
 * 3. 默认 action
 * afterRun 统一接收返回值（如 sync-docs --check 失败 exit(1)）
 */
async function runDefinition(command, def, positionals, options) {
  if (def.optionRoutes) {
    const matched = def.optionRoutes.filter(r => options[r.flag] === r.when);
    if (matched.length > 0) {
      for (const route of matched) {
        await callImpl(route.impl, route.args ? route.args(positionals, options) : [options]);
      }
      return;
    }
  }

  if (def.subcommands) {
    const sub = positionals[0];
    if (sub != null) {
      const entry = def.subcommands[sub];
      if (entry) {
        const result = await callImpl(entry.impl, entry.args ? entry.args(positionals.slice(1), options) : [options]);
        if (def.afterRun) def.afterRun(result, options);
        return;
      }
      if (def.subcommandStrict !== false) {
        console.error(`未知子命令: ${sub}`);
        process.exit(1);
      }
      // 非 strict（如 spec）：未知位置参数落回默认 action
    } else {
      // 无子命令时显示帮助
      command.help();
      return;
    }
  }

  if (!def.action) {
    command.help();
    return;
  }
  const result = await callImpl(def.action, def.mapActionArgs ? def.mapActionArgs(positionals, options) : [options]);
  if (def.afterRun) def.afterRun(result, options);
}

const program = new Command();

program
  .name('harness')
  .description('通用工程约束框架 - 铁律系统、检查点验证、测试门控、执行追踪')
  .version(version);

// ========================================
// 非门禁命令：COMMAND_DEFINITIONS 注册表驱动生成
// ========================================
for (const def of COMMAND_DEFINITIONS) {
  buildCommand(program, def);
}

// ========================================
// 门禁命令（6 个）：GATE_DEFINITIONS.cli 注册表驱动生成（G1）
// ========================================
for (const def of GATE_DEFINITIONS) {
  const cli = def.cli;
  const command = program.command(cli.command + (cli.argument ? ' ' + cli.argument : ''));
  command.description(cli.description);
  if (cli.alias) {
    command.alias(cli.alias);
  }
  for (const opt of cli.options) {
    if (opt.defaultValue !== undefined) {
      command.option(opt.flags, opt.description, opt.defaultValue);
    } else {
      command.option(opt.flags, opt.description);
    }
  }
  command.action(async (arg, options) => {
    // commander：无位置参数的命令把 options 传入第一个形参
    const realArg = cli.argument ? arg : undefined;
    const realOptions = cli.argument ? options : arg;
    const sub = cli.subcommands && realArg != null ? cli.subcommands[realArg] : undefined;
    if (sub) {
      await callImpl(sub, [realOptions]);
    } else {
      await callImpl(cli.action, cli.mapActionArgs(realArg, realOptions));
    }
  });
}

// 解析命令行参数
program.parse();
