/**
 * sync-docs 的 --gate 形态（harness#189；Phase 3 自 index.ts 拆出，纯移位）
 *
 * --gate = 自愈写入 + vs HEAD 漂移判定，与 --check/--json/--compact 互斥。
 * 本文件收两个断面：前置用法校验（脏用法零落盘，先于任何写入）与
 * 写入完成后的 gate 判定尾部（有 diff 判 fail 且点名缺登记文件）。
 * 判定本体（git 取证）住 `head-gate.ts`。
 */

import chalk from 'chalk';
import {
  assertHeadGateEnv,
  diffManagedDocsAgainstHead,
  missingRegistrationNames,
} from './head-gate';
import { log, type CommandIO, type CommandResult } from '../../command-contract';

/**
 * --gate 前置校验：与只读/迁移形态互斥（不猜意图）；非 git 仓库或无 HEAD →
 * usage-error 且零落盘（前置校验先于写入）。返回 null = 放行。
 */
export function assertGateUsage(
  options: { check?: boolean; json?: boolean; compact?: boolean },
  projectPath: string,
): CommandResult | null {
  const isCheck = options.check === true;
  const isJson = options.json === true;
  if (isCheck || isJson || options.compact) {
    return {
      kind: 'usage-error',
      reason: '--gate 与 --check/--json/--compact 互斥（gate = 自愈写入 + vs HEAD 漂移判定）',
    };
  }
  try {
    assertHeadGateEnv(projectPath);
  } catch (err) {
    return { kind: 'usage-error', reason: (err as Error).message };
  }
  return null;
}

/**
 * --gate 的收尾判定：写入完成后判定被管理文档相对 HEAD 的漂移。
 * 自愈顺序不变（写入永远在校验之前）；「需要自愈」本身成为失败，
 * diff 新增行即缺登记名单（不退回裸 check 式不点名的红）。
 */
export function runHeadGateVerdict(
  projectPath: string,
  options: { agents?: boolean },
  contextMissing: string[],
  io: CommandIO,
): CommandResult {
  const managedFiles = [
    'CAPABILITIES.md',
    ...(options.agents ? ['AGENTS.md'] : []),
    ...contextMissing.map((d) => `${d}/CONTEXT.md`),
  ];
  const gateDrift = diffManagedDocsAgainstHead(projectPath, managedFiles);
  if (gateDrift.files.length === 0) {
    log(io, chalk.green('\n✅ 被管理文档与 HEAD 一致'));
    return { kind: 'ok' };
  }
  log(io, chalk.red('\n❌ 被管理文档相对 HEAD 已过期（自愈写入已落盘，需提交）:'));
  gateDrift.files.forEach((f) => log(io, chalk.gray(`  - ${f}`)));
  if (gateDrift.capAdded.length > 0) {
    log(io, chalk.yellow('  缺登记/新增（diff 新增行即名单）:'));
    gateDrift.capAdded.forEach((l) => log(io, chalk.gray(`    + ${l}`)));
  }
  if (gateDrift.capRemoved.length > 0) {
    log(io, chalk.yellow('  撤登记/删除（diff 删除行）:'));
    gateDrift.capRemoved.forEach((l) => log(io, chalk.gray(`    - ${l}`)));
  }
  log(io, chalk.gray('  请本地运行 harness sync-docs 并提交结果。'));
  const names = missingRegistrationNames(gateDrift.capAdded);
  const reason = `被管理文档相对 HEAD 已过期：${gateDrift.files.join('、')}`
    + (names.length > 0 ? `；缺登记：${names.join('、')}` : '');
  return { kind: 'fail', reason };
}
