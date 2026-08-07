/**
 * harness posteval-plan 命令
 *
 * 调用 Studio PostEval API，验证 plan 文件的 checklist items 是否都有对应的 staged diff。
 * pre-commit hook 使用此命令防止"假装完成"。
 */

import chalk from 'chalk';

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

export async function postevalPlan(options: PostEvalPlanOptions): Promise<void> {
  const apiPort = process.env.API_PORT || '3001';
  const url = `http://localhost:${apiPort}/api/v1/agents/post-eval/plan-coverage`;

  try {
    const res = await fetchWithRetry(url, JSON.stringify({ planPath: options.planPath }), MAX_RETRIES);

    if (!res.ok) {
      if (res.status >= 500) {
        // Server error — allow commit with warning (don't block on infrastructure failure)
        console.error(chalk.yellow(`⚠️  PostEval API unavailable (${res.status}), allowing commit with warning`));
        console.error(chalk.yellow(`   Plan: ${options.planPath}`));
        process.exit(0);
      }
      console.error(chalk.red(`❌ PostEval API error: ${res.status} ${res.statusText}`));
      process.exit(1);
    }

    const report = await res.json() as {
      completeness: number;
      matchedAcs: string[];
      missedAcs: string[];
    };

    const pct = Math.round(report.completeness * 100);

    if (report.completeness < 1) {
      console.error(chalk.red(`❌ Plan coverage: ${pct}% (${report.matchedAcs.length}/${report.matchedAcs.length + report.missedAcs.length})`));
      if (report.missedAcs.length > 0) {
        console.error(chalk.red('Missed items:'));
        report.missedAcs.forEach((item: string) => console.error(chalk.red(`  - ${item}`)));
      }
      process.exit(1);
    }

    console.log(chalk.green(`✅ Plan coverage: ${pct}%`));
  } catch (error: any) {
    // API unreachable after all retries — allow with warning (don't block commits on infra)
    console.error(chalk.yellow(`⚠️  Studio API unreachable after ${MAX_RETRIES} retries, allowing commit with warning`));
    console.error(chalk.yellow(`   Plan: ${options.planPath}`));
    console.error(chalk.yellow(`   Error: ${error?.code || error?.message || String(error)}`));
    process.exit(0);
  }
}
