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
baseDir 不硬编码 projectRoot 拼接，走 openKnowledgeStore 同一解析点（harness#177）：
缺省与 `harness knowledge` 读口同根，KNOWLEDGE_BASE_DIR 覆盖对写口同步生效。
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
 * 交互与执行分离：retireConstraint 为纯执行逻辑（同步、可测），
 * runRetireInteractive 只做 readline 交互，IO 流可注入。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { getConstraint } from '../../core/constraints/definitions';
import { ProjectConfigLoader } from '../../core/project-config-loader';
import { loadAppConstraints } from '../../core/app-constraints-loader';
import type { RunTarget } from '../../core/constraints/run-env';
import type { KnowledgeEntry } from '../../knowledge/types';
import type { Constraint } from '../../types/constraint';
import { openKnowledgeStore } from './knowledge-view';
import { fileStateIO } from '../state-io';
import {
  buildConstraintsUsageReport,
  CANDIDATE_KIND_LABEL,
  collectUsageByConstraint,
  readProjectTraces,
  readProjectTracesReport,
  WATCHLIST_PERIOD_DAYS,
} from '../../core/constraints/usage-report';

export interface RetireExecuteOptions {
  /** 退役原因（可空） */
  reason?: string;
  /** 注入当前时间（测试用） */
  now?: Date;
  /** 知识库路径解析的 io（legacy 兜底告警走 stderr 需要；缺省 processIO） */
  io?: CommandIO;
}

export type RetireStatus = 'retired' | 'already_retired' | 'unknown_id';

export interface RetireResult {
  id: string;
  status: RetireStatus;
  /** 是否 severity='error'（交互模式据此追加确认） */
  isError: boolean;
  stats: { total: number; fail: number; failRate: number };
  /** KnowledgeStore 条目 id（status='retired' 时存在） */
  knowledgeEntryId?: string;
  /** 退役记录实际落盘的知识库根（status='retired' 时存在，harness#177） */
  knowledgeBaseDir?: string;
}

export interface ConstraintsRetireOptions {
  projectPath?: string;
  reason?: string;
  /** 直达模式显式确认（--yes）：ADR-0001 决策 2 人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

export interface RetireTargetInfo {
  severity: Constraint['severity'];
  description?: string;
  rule?: string;
  message?: string;
  /** 约束来源（ADR-0033）：app 层退休沉淀条目 tags 加 source:app */
  source?: Constraint['source'];
}

/**
 * 查找约束定义（内置 definitions + 应用层 constraints.yml，ADR-0033）
 *
 * loader 由调用方给（一次退役一份观察面，见 retireConstraint）：本函数只读它的装载结果，
 * 不再自造 ProjectConfigLoader。应用层查找经 target 参数（项目根路径或观察面），
 * 不传 = 只查内置（历史行为）。
 *
 * 导出给 constraints-reactivate 复用（复活同样认内置 + 应用层 check 约束）。
 */
export function findRetireTarget(id: string, target?: RunTarget): RetireTargetInfo | undefined {
  const builtIn = getConstraint(id);
  if (builtIn) {
    return {
      severity: builtIn.severity,
      description: builtIn.description,
      rule: builtIn.rule,
      message: builtIn.message,
      source: 'builtin',
    };
  }
  if (target !== undefined) {
    const app = loadAppConstraints(target).find(c => c.id === id);
    if (app) {
      return {
        severity: app.severity,
        description: app.description,
        rule: app.rule,
        message: app.message,
        source: 'app',
      };
    }
  }
  return undefined;
}

/**
 * YAML 条目的读-改-写单点（harness#137）
 *
 * js-yaml 不保留注释：原文件含注释行时重写会丢失，console 说明（`label` 是给用户看的
 * 文件名）。落盘字节由 `__tests__/constraints-retire.test.ts`
 * 的逐字节冻结用例钉住——合并属内部重构，对外产物不得漂移。
 */
function setYamlEntry(
  filePath: string,
  label: string,
  section: string,
  id: string,
  patch: Record<string, unknown>
): void {
  let raw: Record<string, unknown> = {};
  let hadComments = false;
  if (fs.existsSync(filePath)) {
    const original = fs.readFileSync(filePath, 'utf-8');
    hadComments = original.split('\n').some(l => l.trimStart().startsWith('#'));
    raw = (yaml.load(original) as Record<string, unknown>) ?? {};
  }

  const entries = (raw[section] ?? {}) as Record<string, unknown>;
  const prev = (entries[id] ?? {}) as Record<string, unknown>;
  entries[id] = { ...prev, ...patch };
  raw[section] = entries;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');

  if (hadComments) {
    console.log(chalk.yellow(`   ⚠️  ${label} 已重写：js-yaml 不保留原文件注释`));
  }
}

/**
 * YAML 条目的删除单点（constraints reactivate 用，与 setYamlEntry 同一读-改-写口径）
 *
 * 删除 config.yml `section.id` 整个 key；段/条目不存在时零写盘。返回是否实际删除。
 */
export function removeYamlEntry(filePath: string, section: string, id: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const raw = (yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>) ?? {};
  const entries = (raw[section] ?? {}) as Record<string, unknown>;
  if (!(id in entries)) return false;
  delete entries[id];
  raw[section] = entries;
  fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');
  return true;
}

/**
 * 落盘后 commit 提示（票 02 断点 4）：仅 git 仓内提示，不替用户动 git。
 * studio 审卡通道由 applier 自动 commit，本提示面向 CLI 直达/裸项目场景。
 */
export function logCommitHint(projectRoot: string, io: CommandIO): void {
  if (!fs.existsSync(path.join(projectRoot, '.git'))) return;
  log(io, chalk.gray('   提示：config.yml 已改未提交——git add .harness/config.yml && git commit（studio 审卡通道会自动 commit）'));
}

/**
 * 写 KnowledgeStore 退役记录（consumptionMode: 'signal'）
 *
 * baseDir 走 openKnowledgeStore 同一解析点（harness#177）：缺省与 knowledge 读口同根，
 * 不再硬编码 projectRoot 拼接（那会写进没有任何默认读口的 <repo>/.harness/knowledge）。
 */
function saveRetireKnowledge(
  id: string,
  target: RetireTargetInfo,
  reason: string,
  stats: { total: number; fail: number; failRate: number },
  iso: string,
  io: CommandIO
): { entryId: string; baseDir: string } {
  const entryId = `constraint-retired-${id}`;
  const contentLines = [
    `# 约束退役：${id}`,
    '',
    '## 规则原文',
    '',
    target.description ? `description: ${target.description}` : undefined,
    target.rule ? `rule: ${target.rule}` : undefined,
    target.message ? `message: ${target.message}` : undefined,
    '',
    '## 退役原因',
    '',
    reason || '（未填写）',
    '',
    '## 历史统计',
    '',
    `- total: ${stats.total}`,
    `- fail: ${stats.fail}`,
    `- failRate: ${Math.round(stats.failRate * 100)}%`,
    '',
    `退役日期: ${iso}`,
  ].filter((l): l is string => l !== undefined);

  const entry: KnowledgeEntry = {
    id: entryId,
    type: 'decision',
    title: `约束退役：${id}`,
    content: contentLines.join('\n'),
    maturity: 'verified',
    layer: 'project',
    created: iso,
    lastReferenced: iso,
    contributors: [],
    projects: [],
    // ADR-0033：应用层退休沉淀带 source:app 标签（内置条目不加，历史形状不动）
    tags: [
      'constraint-retired',
      `constraint:${id}`,
      `severity:${target.severity}`,
      ...(target.source === 'app' ? ['source:app'] : []),
    ],
    applicablePhases: [],
    sourceReferences: [{ timestamp: iso }],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'signal',
    origin: 'human',
  };

  const store = openKnowledgeStore({}, io);
  store.save(entry);
  return { entryId, baseDir: store.getBaseDir() };
}

/**
 * 执行单条约束退役（纯执行逻辑，无交互）
 *
 * 不存在的 id / 已退役的 id 通过 status 返回，由调用方提示。
 */
export function retireConstraint(
  projectRoot: string,
  id: string,
  options: RetireExecuteOptions = {}
): RetireResult {
  const now = options.now ?? new Date();
  const iso = now.toISOString();
  const reason = options.reason ?? '';

  // 一次退役一份观察面（ADR-0023 决策 2）：定义查找与 already_retired 判定共用这一份装载结果。
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();

  const target = findRetireTarget(id, projectRoot);
  const emptyStats = { total: 0, fail: 0, failRate: 0 };
  if (!target) {
    return { id, status: 'unknown_id', isError: false, stats: emptyStats };
  }
  const isError = target.severity === 'error';

  // 已退役保护：只认 retired 墓碑（ADR-0032 决策 6.6，票 02 断点 6）——
  // 裸 enabled:false 是"禁用"不是"退休"，落到下面正常退休流程：覆写墓碑 + 补写沉淀，
  // 不让一次裸 disable 吞掉 retire 的知识沉淀。
  const existing = loader.getConfig().constraints?.[id] as { enabled?: boolean; retired?: unknown } | undefined;
  if (existing?.enabled === false && existing.retired) {
    return { id, status: 'already_retired', isError, stats: emptyStats };
  }

  // 历史统计（来自 traces.log）
  // 计数去向：兼容包装 readProjectTraces() 丢计数（harness#100）——落盘的 retire stats 只计
  // 合法记录，把坏行数写进 RetireResult.stats 属形状变更不在本票；本函数按契约「纯执行无交互」
  // 不打印，告知由两条命令入口各自负责（runRetireInteractive 顶部 / constraintsRetire 的 --yes 分支）
  const usage = collectUsageByConstraint(readProjectTraces(projectRoot)).get(id);
  const evaluated = usage ? usage.total - usage.skip : 0;
  const stats = {
    total: usage?.total ?? 0,
    fail: usage?.fail ?? 0,
    failRate: evaluated > 0 ? (usage!.fail / evaluated) : 0,
  };

  // 1. 落盘退役（config.yml enabled:false + retired 段，原文保留）
  const retiredMeta = { at: iso, reason, stats };
  setYamlEntry(
    path.join(projectRoot, '.harness', 'config.yml'),
    'config.yml',
    'constraints',
    id,
    { enabled: false, retired: retiredMeta }
  );

  // 2. KnowledgeStore
  const { entryId: knowledgeEntryId, baseDir: knowledgeBaseDir } = saveRetireKnowledge(
    id,
    target,
    reason,
    stats,
    iso,
    options.io ?? processIO
  );

  return {
    id,
    status: 'retired',
    isError,
    stats,
    knowledgeEntryId,
    knowledgeBaseDir,
  };
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
  // 退役结果打印走注入流（与 readline 提示同一去向）
  const out = { stdout: io.output, stderr: io.output } as unknown as CommandIO;

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
