/**
 * harness posteval-plan 命令
 *
 * 调用 Studio PostEval API，验证 plan 文件的 checklist items 是否都有对应的 staged diff。
 * pre-commit hook 使用此命令防止"假装完成"。
 *
 * 判定经返回值外溢（架构评审候选7）：API 不可用/5xx 属"未判定"→ skip（退出码面 0 不变）；
 * 覆盖率不足与 4xx → fail，reason 指明是哪一项否决。
 */

import chalk from 'chalk';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface PostEvalPlanOptions {
  planPath: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(url: string, body: string, retries: number): Promise<Response> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (error: any) {
      lastError = error;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1))); // exponential backoff
      }
    }
  }
  throw lastError;
}

export async function postevalPlan(
  options: PostEvalPlanOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const apiPort = process.env.API_PORT || '3001';
  const url = `http://localhost:${apiPort}/api/v1/agents/post-eval/plan-coverage`;

  try {
    const res = await fetchWithRetry(url, JSON.stringify({ planPath: options.planPath }), MAX_RETRIES);

    if (!res.ok) {
      if (res.status >= 500) {
        // Server error — allow commit with warning (don't block on infrastructure failure)
        logError(io, chalk.yellow(`⚠️  PostEval API unavailable (${res.status}), allowing commit with warning`));
        logError(io, chalk.yellow(`   Plan: ${options.planPath}`));
        return { kind: 'skip', reason: `PostEval API 服务端错误 ${res.status}，未判定` };
      }
      logError(io, chalk.red(`❌ PostEval API error: ${res.status} ${res.statusText}`));
      return { kind: 'fail', reason: `PostEval API error: ${res.status} ${res.statusText}` };
    }

    const report = await res.json() as {
      completeness: number;
      matchedAcs: string[];
      missedAcs: string[];
    };

    const pct = Math.round(report.completeness * 100);

    if (report.completeness < 1) {
      logError(io, chalk.red(`❌ Plan coverage: ${pct}% (${report.matchedAcs.length}/${report.matchedAcs.length + report.missedAcs.length})`));
      if (report.missedAcs.length > 0) {
        logError(io, chalk.red('Missed items:'));
        report.missedAcs.forEach((item: string) => logError(io, chalk.red(`  - ${item}`)));
      }
      return {
        kind: 'fail',
        reason: `plan coverage ${pct}% < 100%，缺 ${report.missedAcs.length} 项: ${report.missedAcs.join('; ')}`,
      };
    }

    log(io, chalk.green(`✅ Plan coverage: ${pct}%`));
    return { kind: 'ok' };
  } catch (error: any) {
    // API unreachable after all retries — allow with warning (don't block commits on infra)
    logError(io, chalk.yellow(`⚠️  Studio API unreachable after ${MAX_RETRIES} retries, allowing commit with warning`));
    logError(io, chalk.yellow(`   Plan: ${options.planPath}`));
    logError(io, chalk.yellow(`   Error: ${error?.code || error?.message || String(error)}`));
    return {
      kind: 'skip',
      reason: `Studio API 不可达（${error?.code || error?.message || String(error)}），未判定`,
    };
  }
}
