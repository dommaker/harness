/**
 * init --print-snippets 的片段视图（Phase 3 自 init.ts 拆出，纯移位）
 *
 * 打印给用户的片段必须是落盘正文的一部分（#103 判据）且由正本裁剪派生
 * （harness#153 / harness#157：GitHub 片段 = harness-check.yml 的 job 段之后，
 * GitLab 片段 = renderGitLabCiJobs(governanceLevel)，与落盘同一个正本函数）。
 */

import chalk from 'chalk';
import type { CiPlatform } from '../../../types/project-config';
import { log, type CommandIO } from '../../command-contract';
import {
  GITHUB_ACTIONS_SNIPPET,
  renderGitLabCiJobs,
  PRE_COMMIT_SNIPPET,
  PRE_PUSH_SNIPPET,
} from '../scaffold-templates';

/**
 * 输出代码片段（CI 片段按解析出的平台出形，harness#143）
 *
 * gitlab 形打 `renderGitLabCiJobs(governanceLevel)`——与落盘 / 冲突分支同一个函数
 * 的正本（harness#157：曾打无 level 的 GITLAB_CI_SNIPPET，`-g` 档照抄的用户少拿
 * 治理与 docs 新鲜度两个任务）。
 */
export function printSnippets(
  io: CommandIO,
  platform: CiPlatform | 'none',
  governanceLevel: string | undefined,
): void {
  log(io, chalk.blue('📄 Harness 配置代码片段'));
  log(io);

  log(io, chalk.yellow('Git pre-commit hook:'));
  log(io, chalk.gray('添加到 .git/hooks/pre-commit'));
  log(io);
  log(io, chalk.cyan(PRE_COMMIT_SNIPPET));

  log(io, chalk.yellow('Git pre-push hook:'));
  log(io, chalk.gray('添加到 .git/hooks/pre-push（pre-commit 查暂存的、快反馈，这道查整仓的、全量兜底——重复是设计使然）'));
  log(io);
  log(io, chalk.cyan(PRE_PUSH_SNIPPET));

  if (platform === 'gitlab') {
    log(io, chalk.yellow('GitLab CI:'));
    log(io, chalk.gray('添加到 .gitlab-ci.yml'));
    log(io);
    log(io, chalk.cyan(renderGitLabCiJobs(governanceLevel)));
  } else {
    log(io, chalk.yellow('GitHub Actions:'));
    log(io, chalk.gray('添加到 .github/workflows/*.yml 的 jobs 下（以下正文取自 harness-check.yml 的 job 段）'));
    log(io);
    log(io, chalk.cyan(GITHUB_ACTIONS_SNIPPET));
  }

  log(io, chalk.blue('💡 提示: 运行 npx @dommaker/harness init 自动创建配置文件'));
}
