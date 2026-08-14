/**
 * harness constraints retire —— 约束退役（ADR-0001 决策 2/5）
 *
 * 建议层全自动（候选诊断复用 report 数据层），执行层保留一次人确认。
 * 落盘形态（#82 D6 一处真相）：
 *
 * - 内置约束 → config.yml `enabled: false` + `retired` 元数据：
 *
 *     constraints:
 *       <id>:
 *         enabled: false
 *         retired: { at, reason, stats: { total, fail, failRate } }
 *
 * - custom 约束 → custom-constraints.yml 条目内 `retired` 元数据段
 *   （不拆 config.yml 第二处）：
 *
 *     custom_constraints:
 *       <id>:
 *         rule: ...
 *         retired: { at, reason, stats: { total, fail, failRate } }
 *
 * 每条同时写一条 KnowledgeStore 记录（consumptionMode: 'signal'），
 * 并同步 CLAUDE.md 注入段（存在 HARNESS_CONSTRAINTS 标记时）。
 *
 * retire 不是删除——恢复方法：内置删 config.yml 中 constraints.<id> 段；
 * custom 删 custom-constraints.yml 中 custom_constraints.<id>.retired 段。
 *
 * 交互与执行分离：retireConstraint 为纯执行逻辑（同步、可测），
 * runRetireInteractive 只做 readline 交互，IO 流可注入。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { getConstraint } from '../../core/constraints/definitions';
import { renderConstraintsSection, CONSTRAINTS_START_MARKER, CONSTRAINTS_END_MARKER } from '../../core/constraints/injection-renderer';
import { getEffectiveConstraints } from '../../core/effective-constraints';
import { loadRawProjectConfig, ProjectConfigLoader } from '../../core/project-config-loader';
import { FileKnowledgeStore } from '../../knowledge/store';
import type { KnowledgeEntry } from '../../knowledge/types';
import type { Constraint } from '../../types/constraint';
import {
  buildConstraintsUsageReport,
  collectUsageByConstraint,
  readProjectTraces,
  type RetireCandidate,
} from '../../core/constraints/usage-report';
import { getConstraintsMeta } from './constraints';

export interface RetireExecuteOptions {
  /** 退役原因（可空） */
  reason?: string;
  /** 注入当前时间（测试用） */
  now?: Date;
}

export type RetireStatus = 'retired' | 'already_retired' | 'unknown_id';

export interface RetireResult {
  id: string;
  status: RetireStatus;
  /** 是否 check 层 iron（交互模式据此追加确认） */
  isIronLaw: boolean;
  /** 退役落点：custom 约束落 custom-constraints.yml（#82 D6），内置落 config.yml */
  landing: 'config.yml' | 'custom-constraints.yml';
  stats: { total: number; fail: number; failRate: number };
  /** CLAUDE.md 注入段是否已同步 */
  claudeMdSynced: boolean;
  /** KnowledgeStore 条目 id（status='retired' 时存在） */
  knowledgeEntryId?: string;
}

export interface ConstraintsRetireOptions {
  projectPath?: string;
  reason?: string;
  /** 直达模式显式确认（--yes）：ADR-0001 决策 2 人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

interface RetireTargetInfo {
  source: 'builtin' | 'custom';
  isIronLaw: boolean;
  level: Constraint['level'];
  description?: string;
  rule?: string;
  message?: string;
  promptInjection?: string;
}

/**
 * 查找约束定义（内置 definitions + 项目 custom-constraints）
 */
function findRetireTarget(projectRoot: string, id: string): RetireTargetInfo | undefined {
  const builtIn = getConstraint(id);
  if (builtIn) {
    return {
      source: 'builtin',
      isIronLaw: builtIn.kind === 'check' && builtIn.level === 'iron_law',
      level: builtIn.level,
      description: builtIn.description,
      rule: builtIn.rule,
      message: builtIn.message,
      promptInjection: builtIn.promptInjection,
    };
  }

  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const custom = loader.getCustomConstraints()[id];
  if (custom) {
    const level = custom.level || 'guideline';
    return {
      source: 'custom',
      isIronLaw: false, // custom 约束统一 kind='prompt'（无 checker），不存在 check 层 iron
      level,
      description: custom.description,
      rule: custom.rule,
      message: custom.message,
      promptInjection: custom.promptInjection,
    };
  }

  return undefined;
}

/**
 * 读取 harness 版本（与 init.ts 同路径策略）
 */
function getHarnessVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 写 config.yml 退役段（ADR-0001 决策 5）
 *
 * js-yaml 不保留注释：原文件含注释行时重写会丢失，console 说明。
 */
function writeRetireConfig(
  projectRoot: string,
  id: string,
  retiredMeta: { at: string; reason: string; stats: { total: number; fail: number; failRate: number } }
): void {
  const configPath = path.join(projectRoot, '.harness', 'config.yml');

  let raw: Record<string, unknown> = {};
  let hadComments = false;
  if (fs.existsSync(configPath)) {
    const original = fs.readFileSync(configPath, 'utf-8');
    hadComments = original.split('\n').some(l => l.trimStart().startsWith('#'));
    raw = (yaml.load(original) as Record<string, unknown>) ?? {};
  }

  const constraints = (raw.constraints ?? {}) as Record<string, unknown>;
  const prev = (constraints[id] ?? {}) as Record<string, unknown>;
  constraints[id] = { ...prev, enabled: false, retired: retiredMeta };
  raw.constraints = constraints;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');

  if (hadComments) {
    console.log(chalk.yellow('   ⚠️  config.yml 已重写：js-yaml 不保留原文件注释'));
  }
}

/**
 * 写 custom-constraints.yml 退役段（#82 D6 统一落点）
 *
 * 在 custom_constraints.<id> 条目内追加 retired 元数据，保留规则原文。
 * js-yaml 不保留注释：原文件含注释行时重写会丢失，console 说明。
 */
function writeCustomRetireYml(
  projectRoot: string,
  fileName: string,
  id: string,
  retiredMeta: { at: string; reason: string; stats: { total: number; fail: number; failRate: number } }
): void {
  const filePath = path.join(projectRoot, '.harness', fileName);

  let raw: Record<string, unknown> = {};
  let hadComments = false;
  if (fs.existsSync(filePath)) {
    const original = fs.readFileSync(filePath, 'utf-8');
    hadComments = original.split('\n').some(l => l.trimStart().startsWith('#'));
    raw = (yaml.load(original) as Record<string, unknown>) ?? {};
  }

  const customs = (raw.custom_constraints ?? {}) as Record<string, Record<string, unknown>>;
  const prev = customs[id] ?? {};
  customs[id] = { ...prev, retired: retiredMeta };
  raw.custom_constraints = customs;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');

  if (hadComments) {
    console.log(chalk.yellow('   ⚠️  custom-constraints.yml 已重写：js-yaml 不保留原文件注释'));
  }
}

/**
 * 写 KnowledgeStore 退役记录（consumptionMode: 'signal'）
 */
function saveRetireKnowledge(
  projectRoot: string,
  id: string,
  target: RetireTargetInfo,
  reason: string,
  stats: { total: number; fail: number; failRate: number },
  iso: string
): string {
  const entryId = `constraint-retired-${id}`;
  const contentLines = [
    `# 约束退役：${id}`,
    '',
    '## 规则原文',
    '',
    target.description ? `description: ${target.description}` : undefined,
    target.rule ? `rule: ${target.rule}` : undefined,
    target.message ? `message: ${target.message}` : undefined,
    target.promptInjection ? `promptInjection: ${target.promptInjection}` : undefined,
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
    tags: ['constraint-retired', `constraint:${id}`, `level:${target.level}`],
    applicablePhases: [],
    sourceReferences: [{ timestamp: iso }],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'signal',
    origin: 'human',
  };

  const store = new FileKnowledgeStore({ baseDir: path.join(projectRoot, '.harness', 'knowledge') });
  store.save(entry);
  return entryId;
}

/**
 * 同步 CLAUDE.md 注入段（存在 HARNESS_CONSTRAINTS 标记时）
 *
 * 复用 renderConstraintsSection（P3 导出纯函数）按退役后生效集重渲染。
 * 无标记段不动（不追加——retire 不承担 init 职责）。
 */
function syncClaudeMdInjection(projectRoot: string): boolean {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) return false;

  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  const startIdx = content.indexOf(CONSTRAINTS_START_MARKER);
  const endIdx = content.indexOf(CONSTRAINTS_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false;

  const body = renderConstraintsSection(getEffectiveConstraints(projectRoot), getHarnessVersion());
  const after = content.slice(endIdx + CONSTRAINTS_END_MARKER.length).replace(/^\n+/, '');
  const newContent = content.slice(0, startIdx) + body + (after ? '\n' + after : '');
  if (newContent !== content) {
    fs.writeFileSync(claudeMdPath, newContent, 'utf-8');
  }
  return true;
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

  const target = findRetireTarget(projectRoot, id);
  const emptyStats = { total: 0, fail: 0, failRate: 0 };
  const landing: RetireResult['landing'] =
    target?.source === 'custom' ? 'custom-constraints.yml' : 'config.yml';
  if (!target) {
    return { id, status: 'unknown_id', isIronLaw: false, landing, stats: emptyStats, claudeMdSynced: false };
  }

  // 已退役保护：内置看 config.yml constraints.<id>.enabled === false；
  // custom 看 yml 条目 retired 元数据（历史落点 config.yml enabled:false 同样保护）
  const rawConfig = loadRawProjectConfig(projectRoot);
  const existing = (rawConfig?.constraints as Record<string, { enabled?: boolean; retired?: unknown }> | undefined)?.[id];
  if (target.source === 'custom') {
    const loader = new ProjectConfigLoader(projectRoot);
    loader.load();
    if (loader.getCustomConstraints()[id]?.retired || existing?.enabled === false) {
      return { id, status: 'already_retired', isIronLaw: target.isIronLaw, landing, stats: emptyStats, claudeMdSynced: false };
    }
  } else if (existing?.enabled === false) {
    return { id, status: 'already_retired', isIronLaw: target.isIronLaw, landing, stats: emptyStats, claudeMdSynced: false };
  }

  // 历史统计（来自 traces.log）
  const usage = collectUsageByConstraint(readProjectTraces(projectRoot)).get(id);
  const evaluated = usage ? usage.total - usage.skip : 0;
  const stats = {
    total: usage?.total ?? 0,
    fail: usage?.fail ?? 0,
    failRate: evaluated > 0 ? (usage!.fail / evaluated) : 0,
  };

  // 1. 落盘退役（custom → yml 条目 retired 段；内置 → config.yml，原文均保留）
  if (target.source === 'custom') {
    const loader = new ProjectConfigLoader(projectRoot);
    loader.load();
    const customFile = loader.getConfig().custom_constraints_file ?? 'custom-constraints.yml';
    writeCustomRetireYml(projectRoot, customFile, id, { at: iso, reason, stats });
  } else {
    writeRetireConfig(projectRoot, id, { at: iso, reason, stats });
  }

  // 2. KnowledgeStore
  const knowledgeEntryId = saveRetireKnowledge(projectRoot, id, target, reason, stats, iso);

  // 3. CLAUDE.md 注入段同步
  const claudeMdSynced = syncClaudeMdInjection(projectRoot);

  return { id, status: 'retired', isIronLaw: target.isIronLaw, landing, stats, claudeMdSynced, knowledgeEntryId };
}

/**
 * 打印单条退役结果（含回滚语义提示）
 */
export function printRetireResult(result: RetireResult): void {
  switch (result.status) {
    case 'unknown_id':
      console.log(chalk.red(`❌ ${result.id}: 约束不存在（既非内置也非 custom-constraints），未做任何变更`));
      return;
    case 'already_retired':
      console.log(chalk.yellow(`⚠️  ${result.id}: 已处于退役状态（config.yml 中 enabled: false），跳过`));
      return;
    case 'retired':
      console.log(chalk.green(`✅ ${result.id}: 已退役`));
      console.log(`   历史统计: total=${result.stats.total} fail=${result.stats.fail} fail率=${Math.round(result.stats.failRate * 100)}%`);
      console.log(`   知识沉淀: ${result.knowledgeEntryId}（.harness/knowledge）`);
      if (result.claudeMdSynced) {
        console.log('   已同步 CLAUDE.md 注入段');
      }
      const recovery =
        result.landing === 'custom-constraints.yml'
          ? `删除 custom-constraints.yml 中 custom_constraints.${result.id}.retired 段`
          : `删除 config.yml 中 constraints.${result.id} 段`;
      console.log(chalk.gray(`   retire 不是删除——恢复方法：${recovery}`));
  }
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

const CANDIDATE_KIND_LABEL: Record<RetireCandidate['kind'], string> = {
  zero_trigger: '零触发',
  unevaluable: '不可评估',
  high_noise: '高噪',
  zero_intercept: '零拦截',
};

/**
 * 交互式退役（候选列表 → 编号多选 → 摘要 → 确认 → 执行）
 *
 * IO 流可注入（测试用），默认 process.stdin/stdout。
 */
export async function runRetireInteractive(
  projectRoot: string,
  io: RetireIO = { input: process.stdin, output: process.stdout }
): Promise<void> {
  const report = buildConstraintsUsageReport(projectRoot);
  const { ask, close } = createAsk(io);

  try {
    let selectedIds: string[] = [];

    if (report.candidates.length === 0) {
      console.log(chalk.green('✅ 当前没有退役候选（所有 check 约束信号正常）'));
      const manual = await ask('可手动输入要退役的约束 id（留空取消）: ');
      if (!manual) {
        console.log('已取消');
        return;
      }
      selectedIds = [manual];
    } else {
      console.log(chalk.bold(`退役候选（${report.candidates.length} 条）:`));
      report.candidates.forEach((c, i) => {
        console.log(`  ${i + 1}. [${CANDIDATE_KIND_LABEL[c.kind]}] ${c.id} — ${c.reason}`);
      });
      console.log();
      const answer = await ask('输入编号（逗号分隔多选）或约束 id，留空取消: ');
      if (!answer) {
        console.log('已取消');
        return;
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

    // 逐条收集 reason + iron 二次确认
    const plan: { id: string; reason: string; source: RetireTargetInfo['source'] }[] = [];
    for (const id of selectedIds) {
      const target = findRetireTarget(projectRoot, id);
      if (!target) {
        console.log(chalk.red(`❌ ${id}: 约束不存在，跳过`));
        continue;
      }
      if (target.isIronLaw) {
        const confirm = await ask(chalk.yellow(`⚠️  ${id} 是一条 Iron Law，确认退役？(y/N) `));
        if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
          console.log(`   已跳过 ${id}`);
          continue;
        }
      }
      const reason = await ask(`退役原因（${id}，可留空）: `);
      plan.push({ id, reason, source: target.source });
    }

    if (plan.length === 0) {
      console.log('无可执行项，已取消');
      return;
    }

    // 变更摘要 → 最终确认
    console.log();
    console.log(chalk.bold('将执行以下变更:'));
    for (const p of plan) {
      if (p.source === 'custom') {
        console.log(`  - custom-constraints.yml: custom_constraints.${p.id}.retired 元数据（原因: ${p.reason || '（空）'}）`);
      } else {
        console.log(`  - config.yml: constraints.${p.id}.enabled=false + retired 元数据（原因: ${p.reason || '（空）'}）`);
      }
      console.log(`  - KnowledgeStore: 写入 constraint-retired-${p.id}`);
    }
    console.log('  - CLAUDE.md: 若含 HARNESS_CONSTRAINTS 标记段则同步重渲染');
    const finalConfirm = await ask('确认执行？(y/N) ');
    if (finalConfirm.toLowerCase() !== 'y' && finalConfirm.toLowerCase() !== 'yes') {
      console.log('已取消');
      return;
    }

    console.log();
    for (const p of plan) {
      const result = retireConstraint(projectRoot, p.id, { reason: p.reason });
      printRetireResult(result);
    }
  } finally {
    close();
  }
}

/**
 * CLI handler: harness constraints retire [id]
 *
 * 人确认闸门（#24，ADR-0001 决策 2）：带 id 的直达路径必须显式 `--yes`，
 * 无 `--yes` 报错 + 非零退出码，提示改用 `--yes` 或交互模式；不落盘任何文件。
 */
export async function constraintsRetire(id?: string, options: ConstraintsRetireOptions = {}): Promise<void> {
  const projectRoot = options.projectPath || process.cwd();

  if (id) {
    // 非交互直达：执行层人确认对所有入口成立（含程序化调用方）
    if (!options.yes) {
      console.error(
        chalk.red(`❌ 直达退役需要显式人确认（ADR-0001 决策 2：执行层保留一次人确认），未做任何变更\n`) +
          `   带 --yes 显式确认直达：harness constraints retire ${id} --yes` +
          `${options.reason ? ` --reason "${options.reason}"` : ''}\n` +
          `   或去掉 id 走交互确认：harness constraints retire`
      );
      process.exitCode = 1;
      return;
    }

    const result = retireConstraint(projectRoot, id, { reason: options.reason });
    if (result.status === 'retired' && result.isIronLaw) {
      console.log(chalk.yellow(`⚠️  ${id} 是一条 Iron Law，已通过 --yes 直达退役（交互模式会要求二次确认）`));
    }
    printRetireResult(result);
    return;
  }

  await runRetireInteractive(projectRoot);
}
