/**
 * 脚手架落盘模块（harness#132，架构评审候选3）
 *
 * 一个决策只写一次：受管文件（managed file — harness 模板拥有正本、用户也可能
 * 持有的落盘文件）在不在场、在场时算跳过还是算请用户手工合并、要不要建父目录、
 * 打什么颜色的哪句话，全部收在本模块。此前这段判定复印在 init 6 处 + validate 2 处。
 *
 * 三态：
 * - `created` 不在场 → 落盘模板正文
 * - `exists`  在场 → 灰字告知跳过（**不细分内容是否等于模板**，内容比较是独立特性）
 * - `manual`  在场 → 打印片段请用户手工合并
 *
 * 纪律：本模块不持有覆盖/跳过策略——「哪些文件要落」由命令层翻成 plan 列表传进来，
 * 本模块只见 plan；模板正文住在 `scaffold-templates.ts`。
 */

import * as path from 'path';
import chalk from 'chalk';
import * as nodeFs from 'fs/promises';
import type { CiPlatform } from '../../types/project-config';
import { log, type CommandIO } from '../command-contract';
import {
  CUSTOM_CONSTRAINTS_TEMPLATE,
  DEFAULT_CHECKPOINT_FILE,
  HARNESS_CHECK_WORKFLOW,
  PRE_COMMIT_SNIPPET,
  PRE_PUSH_SNIPPET,
  renderChangelog,
  renderCheckpoints,
  renderContextDoc,
  renderGitLabCiFile,
  renderGitLabCiJobs,
  renderGovernanceWorkflow,
  renderPreCommitHook,
  renderPrePushHook,
  renderResolutions,
} from './scaffold-templates';

/** 三态判定结果 */
export type ScaffoldOutcome = 'created' | 'exists' | 'manual';

/**
 * 落盘注入面（缺省 node fs；测试注入内存替身即可断言「真写出了什么内容」）
 */
export interface ScaffoldFileSystem {
  exists(target: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
  writeFile(target: string, content: string): Promise<void>;
  chmod(target: string, mode: number): Promise<void>;
}

export const nodeScaffoldFs: ScaffoldFileSystem = {
  async exists(target) {
    try {
      await nodeFs.access(target);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(dir) {
    await nodeFs.mkdir(dir, { recursive: true });
  },
  async writeFile(target, content) {
    await nodeFs.writeFile(target, content, 'utf-8');
  },
  async chmod(target, mode) {
    await nodeFs.chmod(target, mode);
  },
};

/**
 * 在场处置：
 * - `skip`  harness 不再主张这份正文，灰字告知即可
 * - `merge` 用户可能持有自己的内容，打印片段（与落盘正文同源）请其手工合并
 */
export type OnPresent =
  | { outcome: 'skip'; notice: string }
  | {
      outcome: 'merge';
      notice: string;
      /** 提示与指引之间的灰字补充行（如冲突来源清单） */
      detail?: string[];
      instruction: string;
      snippet: string;
    };

/** 一个受管文件 = 三态判定所需的全部数据 */
export interface ManagedFile {
  /** 落盘目标（绝对路径） */
  target: string;
  /** harness 拥有的模板正文 */
  content: string;
  /** 落盘态绿字 */
  created: string;
  /** 在场态处置 */
  onPresent: OnPresent;
  /** 在场判定覆写，缺省 = target 自身在场（冲突面可以宽于 target，如 CI 配置目录） */
  present?: () => Promise<boolean>;
  /** 落盘权限位（Git hook 需要可执行位） */
  mode?: number;
}

/**
 * 落一个受管文件：判定 → 建目录 → 写盘 → 上色打印
 */
export async function writeManagedFile(
  file: ManagedFile,
  io: CommandIO,
  fs: ScaffoldFileSystem = nodeScaffoldFs,
): Promise<ScaffoldOutcome> {
  const present = file.present ? await file.present() : await fs.exists(file.target);

  if (!present) {
    await fs.mkdir(path.dirname(file.target));
    await fs.writeFile(file.target, file.content);
    if (file.mode !== undefined) await fs.chmod(file.target, file.mode);
    log(io, chalk.green(file.created));
    return 'created';
  }

  if (file.onPresent.outcome === 'skip') {
    log(io, chalk.gray(file.onPresent.notice));
    return 'exists';
  }

  log(io, chalk.yellow(file.onPresent.notice));
  for (const line of file.onPresent.detail ?? []) {
    log(io, chalk.gray(line));
  }
  log(io, chalk.gray(file.onPresent.instruction));
  log(io);
  log(io, chalk.cyan(file.onPresent.snippet));
  return 'manual';
}

/** 按顺序落一组受管文件 */
export async function runPlan(
  plan: readonly ManagedFile[],
  io: CommandIO,
  fs: ScaffoldFileSystem = nodeScaffoldFs,
): Promise<ScaffoldOutcome[]> {
  const outcomes: ScaffoldOutcome[] = [];
  for (const file of plan) {
    outcomes.push(await writeManagedFile(file, io, fs));
  }
  return outcomes;
}

// ── 站点：init 的 7 处 + 原住 validate 的 2 处 ──────────────────────────

/** .git/hooks/pre-commit（冲突片段 = 落盘正文去掉 shebang 头，逐字同源） */
export function preCommitHookFile(projectPath: string): ManagedFile {
  return {
    target: path.join(projectPath, '.git', 'hooks', 'pre-commit'),
    content: renderPreCommitHook(),
    created: '✅ 已创建 .git/hooks/pre-commit',
    mode: 0o755,
    onPresent: {
      outcome: 'merge',
      notice: '⚠️  .git/hooks/pre-commit 已存在',
      instruction: '💡 请手动添加以下内容到文件末尾：',
      snippet: PRE_COMMIT_SNIPPET,
    },
  };
}

/**
 * .git/hooks/pre-push（harness#144 的第 9 站点，冲突片段与落盘正文逐字同源）
 *
 * 与 pre-commit 的分工：那道查暂存的（增量、快反馈），这道查整仓的（全量、兜底）。
 * 本地 hook 是自检与提醒，门禁真正的落点仍是服务端 CI。
 */
export function prePushHookFile(projectPath: string): ManagedFile {
  return {
    target: path.join(projectPath, '.git', 'hooks', 'pre-push'),
    content: renderPrePushHook(),
    created: '✅ 已创建 .git/hooks/pre-push',
    mode: 0o755,
    onPresent: {
      outcome: 'merge',
      notice: '⚠️  .git/hooks/pre-push 已存在',
      instruction: '💡 请手动添加以下内容到文件末尾：',
      snippet: PRE_PUSH_SNIPPET,
    },
  };
}

/**
 * 服务端 CI 门禁站点（平台维度，harness#143）
 *
 * - `github` → `.github/workflows/harness-check.yml`；冲突判定宽于 target 自身：
 *   工作流目录里已有任何 CI 配置就算冲突，片段是完整 workflow 正文（打印的即落盘的，#103 判据）
 * - `gitlab` → `.gitlab-ci.yml`；冲突面就是该文件自身在场，片段是 harness 拥有的任务正文。
 *   GitLab 没有「第二个 CI 文件位」，所以 `-g` 档的治理任务并入同一份正文
 *   ——这也是 `governanceLevel` 只对 gitlab 形有意义的原因（GH 侧治理站是独立的
 *   `governanceWorkflowFile`）。
 *
 * `none`（不接线）不进来：那是命令层的 plan 里没有这个站点，scaffold 不持有跳过策略。
 */
export function harnessCheckCiFile(
  projectPath: string,
  platform: CiPlatform,
  existingCiWorkflows: string[],
  governanceLevel?: string,
): ManagedFile {
  if (platform === 'gitlab') {
    const content = renderGitLabCiFile(governanceLevel);
    return {
      target: path.join(projectPath, '.gitlab-ci.yml'),
      content,
      created: '✅ 已创建 .gitlab-ci.yml',
      onPresent: {
        outcome: 'merge',
        notice: '⚠️  .gitlab-ci.yml 已存在',
        instruction: '💡 请手动添加以下内容到文件中：',
        snippet: renderGitLabCiJobs(governanceLevel),
      },
    };
  }

  const target = path.join(projectPath, '.github', 'workflows', 'harness-check.yml');
  return {
    target,
    content: HARNESS_CHECK_WORKFLOW,
    created: '✅ 已创建 .github/workflows/harness-check.yml',
    present: async () => existingCiWorkflows.length > 0,
    onPresent: {
      outcome: 'merge',
      notice: '⚠️  检测到已存在的 CI 配置：',
      detail: existingCiWorkflows.map(f => `  - .github/workflows/${f}`),
      instruction: '💡 请手动添加以下内容到 jobs 中：',
      snippet: HARNESS_CHECK_WORKFLOW,
    },
  };
}

/** .harness/custom-constraints.yml 示例 */
export function customConstraintsFile(projectPath: string): ManagedFile {
  return {
    target: path.join(projectPath, '.harness', 'custom-constraints.yml'),
    content: CUSTOM_CONSTRAINTS_TEMPLATE,
    created: '✅ 已创建自定义约束示例: custom-constraints.yml',
    onPresent: { outcome: 'skip', notice: 'custom-constraints.yml 已存在' },
  };
}

/** .harness/checkpoints.yml 示例（原住 validate.ts，路径约定与 validate 共用） */
export function checkpointsFile(projectPath: string): ManagedFile {
  const target = path.join(projectPath, DEFAULT_CHECKPOINT_FILE);
  return {
    target,
    content: renderCheckpoints(),
    created: `✅ 已创建示例检查点文件: ${target}`,
    onPresent: { outcome: 'skip', notice: 'checkpoints.yml 已存在，跳过' },
  };
}

/** .harness/resolutions.json（RKB 狗粮 — 约束 → 已知解法映射，原住 validate.ts） */
export function resolutionsFile(projectPath: string): ManagedFile {
  const target = path.join(projectPath, '.harness', 'resolutions.json');
  return {
    target,
    content: renderResolutions(),
    created: `✅ 已创建 Resolutions 文件: ${target}`,
    onPresent: { outcome: 'skip', notice: 'resolutions.json 已存在，跳过' },
  };
}

/** CHANGELOG.md 骨架 */
export function changelogFile(projectPath: string, format: string): ManagedFile {
  return {
    target: path.join(projectPath, 'CHANGELOG.md'),
    content: renderChangelog(format),
    created: '✅ 已创建 CHANGELOG.md',
    onPresent: { outcome: 'skip', notice: 'CHANGELOG.md 已存在' },
  };
}

/** `<dir>/CONTEXT.md` 骨架 */
export function contextDocFile(projectPath: string, dir: string): ManagedFile {
  return {
    target: path.join(projectPath, dir, 'CONTEXT.md'),
    content: renderContextDoc(dir),
    created: `✅ 已创建 ${dir}/CONTEXT.md`,
    onPresent: { outcome: 'skip', notice: `${dir}/CONTEXT.md 已存在` },
  };
}

/**
 * .github/workflows/harness-governance.yml（治理 CI 面，仅 github 形）
 *
 * gitlab 形的治理任务并入 `.gitlab-ci.yml`（见 `harnessCheckCiFile`），无本站点。
 */
export function governanceWorkflowFile(projectPath: string, level: string): ManagedFile {
  return {
    target: path.join(projectPath, '.github', 'workflows', 'harness-governance.yml'),
    content: renderGovernanceWorkflow(level, 'github'),
    created: '✅ 已创建 .github/workflows/harness-governance.yml',
    onPresent: { outcome: 'skip', notice: 'harness-governance.yml 已存在' },
  };
}
