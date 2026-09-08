/**
 * git 证据适配器（架构评审 #87）
 *
 * 全仓唯一的 git 取证点：context-builder（触发推断）与 checker 层（CheckEnv 证据）
 * 共用同一实例 = 共用同一证据来源。此前两处各自抓真 git，一次 CLI check 里
 * `git diff --cached --name-only` 实跑两遍。
 *
 * seam 上的两个真 adapter：
 * - 缺省 realGitCommandRunner：真 git 子进程
 * - 注入 runner：委托/计数/命令表（测试与定制场景）
 *
 * memo 落在实例层（命令 → 结果，含失败结果），实例生命周期 = 一次 check run，
 * 因此不存在隐式全局（工单 18 的 run 级收益保留，形状改为显式传递）。
 */

import { execSync } from 'child_process';

/**
 * git 命令执行器：返回 trim 后的 stdout，失败抛错（由 adapter 归类为「无该证据」）
 *
 * command 恒为本模块内的固定字面量，cwd 来自调用方（非 shell 拼接），无注入面。
 */
export type GitCommandRunner = (command: string, cwd: string) => string;

/**
 * git 证据：一次 run 内的 git 事实快照，同类命令至多执行一次
 *
 * 判定语义与原 context-builder / checker 私有实现逐条对齐：
 * - diff 类命令失败 → 空串（无变更证据）
 * - ls-tree 失败 → null（调用方按「所有目录都是新目录」处理）
 */
export interface GitEvidence {
  /** 取证基准目录（git 命令的 cwd） */
  readonly projectPath: string;
  /** staged 全量 diff（`git diff --cached`） */
  stagedDiff(): string;
  /** 变更文件名列表，\n 分隔（staged → `git diff --cached --name-only`） */
  changedFileNames(staged: boolean): string;
  /** HEAD 中存在的目录集合；命令失败 → null */
  headDirs(): Set<string> | null;
}

/** 与 utils/exec.runCommand 同一缓冲上限（大 diff 不 ENOBUFS） */
const GIT_MAX_BUFFER = 1024 * 1024;

/**
 * 真 git adapter：同步 spawn，失败抛错交由 memo 归类
 *
 * execSync 声明返回 string | Buffer（Buffer 无 trim），故显式归一为 string——
 * 与迁移前 context-builder 的 `String(output)` 取值语义一致。
 */
export const realGitCommandRunner: GitCommandRunner = (command, cwd) =>
  String(
    execSync(command, { cwd, stdio: 'pipe', encoding: 'utf-8', maxBuffer: GIT_MAX_BUFFER })
  ).trim();

const STAGED_DIFF = 'git diff --cached';
const STAGED_DIFF_NAMES = 'git diff --cached --name-only';
const UNSTAGED_DIFF_NAMES = 'git diff --name-only';
const HEAD_TREE = 'git ls-tree -r --name-only HEAD';

/**
 * 从 `git ls-tree -r --name-only HEAD` 输出提取 HEAD 中存在的所有目录
 *
 * 工单 18 批量语义：一次命令替代逐文件 ls-tree。
 */
export function parseHeadDirs(treeOutput: string): Set<string> {
  const dirs = new Set<string>();
  for (const file of treeOutput.split('\n')) {
    if (!file) continue;
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return dirs;
}

/**
 * 构造 git 证据 adapter（生产侧唯一构造点）
 *
 * @param projectPath 取证目录
 * @param run 命令执行器，缺省真 git；测试注入计数/替身执行器即可脱离子进程
 */
export function createGitEvidence(
  projectPath: string,
  run: GitCommandRunner = realGitCommandRunner
): GitEvidence {
  type CommandResult = { ok: boolean; stdout: string };
  const memo = new Map<string, CommandResult>();

  const once = (command: string): CommandResult => {
    let result = memo.get(command);
    if (!result) {
      try {
        result = { ok: true, stdout: run(command, projectPath) };
      } catch {
        result = { ok: false, stdout: '' };
      }
      memo.set(command, result);
    }
    return result;
  };

  return {
    projectPath,
    stagedDiff: () => once(STAGED_DIFF).stdout,
    changedFileNames: (staged: boolean) =>
      once(staged ? STAGED_DIFF_NAMES : UNSTAGED_DIFF_NAMES).stdout,
    headDirs: () => {
      const result = once(HEAD_TREE);
      return result.ok ? parseHeadDirs(result.stdout) : null;
    },
  };
}

/** 变更文件名列表 → 路径数组（git 无输出时为空集合） */
export function splitFileNames(names: string): string[] {
  return names.split('\n').filter(Boolean);
}
