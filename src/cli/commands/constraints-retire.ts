/**
 * harness constraints retire —— 约束退役（ADR-0001 决策 2/5，ADR-0029 收窄）
 *
 * 建议层全自动（候选诊断复用 report 数据层），执行层保留一次人确认。
 * 落盘形态（一处真相）：
 *
 * - config.yml `enabled: false` + `retired` 元数据：
 *
 *     constraints:
 *       <id>:
 *         enabled: false
 *         retired: { at, reason, stats: { total, fail, failRate } }
 *
 * 每条同时写一条 KnowledgeStore 记录（consumptionMode: 'signal'）。
 * baseDir 不硬编码 projectRoot 拼接，走 openKnowledgeStore 同一解析点（harness#177）：
 * 缺省与 `harness knowledge` 读口同根，KNOWLEDGE_BASE_DIR 覆盖对写口同步生效。
 *
 * ADR-0029：custom 纯文本约束与治理注入段同步已随文本注入层关停一并退役。
 * ADR-0032 观察名单（块 3 子项 4）：零拦截命中先进观察名单（`.harness/.state.json`
 * `constraintWatchlist` 段，StateIO 读-改-写），挂一个季度且样本足才转退役候选——
 * 交互模式的候选清单因此不含观察期内的零拦截约束。
 * ADR-0033：retire 处理内置 + 应用层（`.harness/constraints.yml`）check 约束；
 * 应用层退休墓碑同样写 config.yml，constraints.yml 条文保留不删（退休=停用不是删除），
 * 沉淀条目 tags 加 `source:app`。
 *
 * retire 不是删除——恢复走 `harness constraints reactivate <id>`（ADR-0032 决策 6.5：
 * 复活不改历史，写 constraint-reactivated-<id> 新条目；手动删段无沉淀，不提倡）。
 * already_retired 幂等只认 retired 墓碑（ADR-0032 决策 6.6，票 02 断点 6）：
 * 裸 enabled:false 是"禁用"不是"退休"，会被退休流程接管补上墓碑与沉淀。
 *
 * harness#198：纯执行逻辑（retireConstraint / findRetireTarget 与结果类型）已搬入
 * `core/constraint-lifecycle` 并上公共 barrel（消费方不再偷看 .harness/ 内部）；
 * 本模块是 CLI 薄壳——交互、打印、人确认闸门，外加把知识沉淀写口接进 core 的
 * wired 包装（harness#88 注入纪律：core 不 value-import 知识层）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import chalk from 'chalk';
import {
  retireConstraint as coreRetireConstraint,
  findRetireTarget,
  type LifecycleKnowledgeSink,
  type RetireExecuteOptions,
  type RetireResult,
} from '../../core/constraint-lifecycle';
import { openKnowledgeStore } from './knowledge/store-access';
import { fileStateIO } from '../state-io';
import {
  buildConstraintsUsageReport,
  CANDIDATE_KIND_LABEL,
  readProjectTracesReport,
  WATCHLIST_PERIOD_DAYS,
} from '../../core/constraints/usage-report';

export type {
  RetireExecuteOptions,
  RetireStatus,
  RetireResult,
  RetireTargetInfo,
} from '../../core/constraint-lifecycle';
export { findRetireTarget } from '../../core/constraint-lifecycle';

export interface ConstraintsRetireOptions {
  projectPath?: string;
  reason?: string;
  /** 直达模式显式确认（--yes）：ADR-0001 决策 2 人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

/**
 * CLI 侧 wired 包装的 options：core 执行 options + 知识沉淀写口的输出 IO
 * （io 只被写口接线消费，不是 core 的签名——core RetireExecuteOptions 无此字段）
 */
export interface RetireCliOptions extends RetireExecuteOptions {
  /** 知识沉淀写口的输出 IO（缺省 processIO） */
  io?: CommandIO;
}

/**
 * CLI 侧 wired 包装共形（retire/reactivate 两枚原同形两份）：剥出 io、把知识沉淀
 * 写口接进 core 执行 options（openKnowledgeStore 同一解析点：KNOWLEDGE_BASE_DIR /
 * 用户 home 缺省目录，harness#177）。库消费方请直接用包根导出的执行函数，按需注入
 * openKnowledgeStore。
 */
export function wireKnowledgeSink<T extends { io?: CommandIO; openKnowledgeStore?: () => LifecycleKnowledgeSink }>(
  options: T
): Omit<T, 'io' | 'openKnowledgeStore'> & { openKnowledgeStore: () => LifecycleKnowledgeSink } {
  const { io, openKnowledgeStore: injected, ...coreOptions } = options;
  return {
    ...coreOptions,
    openKnowledgeStore: injected ?? (() => openKnowledgeStore({}, io ?? processIO)),
  };
}

/**
 * CLI 侧 wired 包装：core retireConstraint + 知识沉淀写口接线（接线共形见 wireKnowledgeSink）。
 */
export function retireConstraint(
  projectRoot: string,
  id: string,
  options: RetireCliOptions = {}
): RetireResult {
  return coreRetireConstraint(projectRoot, id, wireKnowledgeSink(options));
}

/**
 * 落盘后 commit 提示（票 02 断点 4）：仅 git 仓内提示，不替用户动 git。
 * 下游审卡通道由 applier 自动 commit，本提示面向 CLI 直达/裸项目场景。
 */
export function logCommitHint(projectRoot: string, io: CommandIO): void {
  if (!fs.existsSync(path.join(projectRoot, '.git'))) return;
  log(io, chalk.gray('   提示：config.yml 已改未提交——git add .harness/config.yml && git commit（下游审卡通道会自动 commit）'));
}

/**
 * 打印单条退役结果（含回滚语义提示）
 */
export function printRetireResult(result: RetireResult, io: CommandIO = processIO, projectRoot?: string): CommandResult {
  switch (result.status) {
    case 'unknown_id':
      log(io, chalk.red(`❌ ${result.id}: 约束不存在（内置与应用层约束中都未找到），未做任何变更`));
      return { kind: 'skip', reason: `${result.id}: 约束不存在，未做任何变更` };
    case 'already_retired':
      log(io, chalk.yellow(`⚠️  ${result.id}: 已处于退役状态（config.yml 有 retired 墓碑），跳过`));
      return { kind: 'skip', reason: `${result.id}: 已处于退役状态，跳过` };
    case 'retired': {
      log(io, chalk.green(`✅ ${result.id}: 已退役`));
      log(io, `   历史统计: total=${result.stats.total} fail=${result.stats.fail} fail率=${Math.round(result.stats.failRate * 100)}%`);
      log(io, `   知识沉淀: ${result.knowledgeEntryId}（${result.knowledgeBaseDir}）`);
      log(io, chalk.gray(`   retire 不是删除——恢复方法：harness constraints reactivate ${result.id}（会写复活沉淀；手动删 config.yml 段则无沉淀）`));
      if (projectRoot) logCommitHint(projectRoot, io);
      break;
    }
  }
  return { kind: 'ok' };
}

// ========================================
// 交互模式
// ========================================

interface RetireIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

function createAsk(io: RetireIO): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  return {
    ask: (q: string) => new Promise(resolve => rl.question(q, ans => resolve(ans.trim()))),
    close: () => rl.close(),
  };
}

/**
 * 交互式退役（候选列表 → 编号多选 → 摘要 → 确认 → 执行）
 *
 * IO 流可注入（测试用），默认 process.stdin/stdout。
 */
export async function runRetireInteractive(
  projectRoot: string,
  io: RetireIO = { input: process.stdin, output: process.stdout }
): Promise<CommandResult> {
  // 观察名单中间态（ADR-0032，块 3 子项 4）：名单内约束不进候选；新列入经 StateIO 写回
  const stateIO = fileStateIO(projectRoot);
  const state = stateIO.read();
  const report = buildConstraintsUsageReport(projectRoot, {}, { watchlist: state.constraintWatchlist });
  if (Object.keys(report.nextWatchlist).length > Object.keys(state.constraintWatchlist ?? {}).length) {
    stateIO.write({ ...state, constraintWatchlist: report.nextWatchlist });
  }
  // 候选诊断是退役决策的依据：数据不完整必须先说（harness#100，与 report 同一降级维度）；
  // 告知行走 stderr，与 status / failure list / 直达分支同一去向（交互正文仍走 console.log）
  if (report.skippedLines > 0) {
    console.error(chalk.yellow(`⚠️  trace 文件有 ${report.skippedLines} 行损坏已跳过，候选只基于其余合法记录`));
  }
  const { ask, close } = createAsk(io);
  // 退役结果打印走注入流（与 readline 提示同一去向）；
  // WritableStream.write(chunk: any) 结构化满足 CommandIO 的最小可写接口
  const out: CommandIO = { stdout: io.output, stderr: io.output };

  try {
    let selectedIds: string[] = [];

    if (report.candidates.length === 0) {
      console.log(chalk.green('✅ 当前没有退役候选（所有 check 约束信号正常）'));
      const manual = await ask('可手动输入要退役的约束 id（留空取消）: ');
      if (!manual) {
        console.log('已取消');
        return { kind: 'skip', reason: '交互未确认，未做任何变更' };
      }
      selectedIds = [manual];
    } else {
      console.log(chalk.bold(`退役候选（${report.candidates.length} 条）:`));
      report.candidates.forEach((c, i) => {
        console.log(`  ${i + 1}. [${CANDIDATE_KIND_LABEL[c.kind]}] ${c.id} — ${c.reason}`);
      });
      if (report.watchlist.length > 0) {
        console.log(chalk.gray(`  （另有 ${report.watchlist.length} 条零拦截约束在观察名单中，满 ${WATCHLIST_PERIOD_DAYS} 天且样本足才转候选——见 harness constraints report）`));
      }
      console.log();
      const answer = await ask('输入编号（逗号分隔多选）或约束 id，留空取消: ');
      if (!answer) {
        console.log('已取消');
        return { kind: 'skip', reason: '交互未确认，未做任何变更' };
      }

      for (const token of answer.split(',').map(s => s.trim()).filter(Boolean)) {
        const idx = Number(token);
        if (Number.isInteger(idx) && idx >= 1 && idx <= report.candidates.length) {
          selectedIds.push(report.candidates[idx - 1].id);
        } else {
          selectedIds.push(token); // 视为手动输入的 id，由 retireConstraint 校验
        }
      }
      selectedIds = [...new Set(selectedIds)];
    }

    // 逐条收集 reason + error 级二次确认
    const plan: { id: string; reason: string }[] = [];
    for (const id of selectedIds) {
      const target = findRetireTarget(id, projectRoot);
      if (!target) {
        console.log(chalk.red(`❌ ${id}: 约束不存在，跳过`));
        continue;
      }
      if (target.severity === 'error') {
        const confirm = await ask(chalk.yellow(`⚠️  ${id} 是一条 error 级约束，确认退役？(y/N) `));
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
          console.log(`   已跳过 ${id}`);
          continue;
        }
      }
      const reason = await ask(`退役原因（${id}，可留空）: `);
      plan.push({ id, reason });
    }

    if (plan.length === 0) {
      console.log('无可执行项，已取消');
      return { kind: 'skip', reason: '交互未确认，未做任何变更' };
    }

    // 变更摘要 → 最终确认
    console.log();
    console.log(chalk.bold('将执行以下变更:'));
    for (const p of plan) {
      console.log(`  - config.yml: constraints.${p.id}.enabled=false + retired 元数据（原因: ${p.reason || '（空）'}）`);
      console.log(`  - KnowledgeStore: 写入 constraint-retired-${p.id}`);
    }
    const finalConfirm = await ask('确认执行？(y/N) ');
    if (finalConfirm.toLowerCase() !== 'y' && finalConfirm.toLowerCase() !== 'yes') {
      console.log('已取消');
      return { kind: 'skip', reason: '交互未确认，未做任何变更' };
    }

    console.log();
    for (const p of plan) {
      const result = retireConstraint(projectRoot, p.id, { reason: p.reason, io: out });
      printRetireResult(result, out, projectRoot);
    }
  } finally {
    close();
  }
  return { kind: 'ok' };
}

/**
 * CLI handler: harness constraints retire [id]
 *
 * 人确认闸门（#24，ADR-0001 决策 2）：带 id 的直达路径必须显式 `--yes`，
 * 无 `--yes` 报错 + 非零退出码，提示改用 `--yes` 或交互模式；不落盘任何文件。
 */
export async function constraintsRetire(
  id?: string,
  options: ConstraintsRetireOptions = {},
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectRoot = options.projectPath || process.cwd();

  if (id) {
    // 非交互直达：执行层人确认对所有入口成立（含程序化调用方）
    if (!options.yes) {
      logError(io,
        chalk.red(`❌ 直达退役需要显式人确认（ADR-0001 决策 2：执行层保留一次人确认），未做任何变更\n`) +
          `   带 --yes 显式确认直达：harness constraints retire ${id} --yes` +
          `${options.reason ? ` --reason "${options.reason}"` : ''}\n` +
          `   或去掉 id 走交互确认：harness constraints retire`
      );
      return { kind: 'usage-error', reason: `直达退役 ${id} 缺少显式 --yes 人确认，未做任何变更` };
    }

    // 落盘的 retire stats 只含合法记录：依据不完整要在执行前告知（harness#100，
    // 直达路径不经过 runRetireInteractive，故两处各自告知）
    const { skippedLines } = readProjectTracesReport(projectRoot);
    if (skippedLines > 0) {
      logError(io, chalk.yellow(`⚠️  trace 文件有 ${skippedLines} 行损坏已跳过，落盘的退役统计只基于其余合法记录`));
    }

    const result = retireConstraint(projectRoot, id, { reason: options.reason, io });
    if (result.status === 'retired' && result.isError) {
      log(io, chalk.yellow(`⚠️  ${id} 是一条 error 级约束，已通过 --yes 直达退役（交互模式会要求二次确认）`));
    }
    return printRetireResult(result, io, projectRoot);
  }

  return runRetireInteractive(projectRoot);
}
