/**
 * sync-docs --gate 的 vs HEAD 漂移判定（harness#189）
 *
 * 语义等价于流水线内联门（harness#120 方案 A）：sync-docs 自愈写入之后，
 * 被管理文档相对 HEAD 有 diff = HEAD 文档过期 → 判 fail；diff 新增行即缺登记名单。
 * tracked 修改与 untracked 新建（本轮自愈补建的 CONTEXT.md / AGENTS.md）都算漂移。
 */

import { execFileSync } from 'child_process';

/** --gate 判定结果 */
export interface HeadGateDrift {
  /** 相对 HEAD 有变更的被管理文档（仓库相对路径，含 untracked 新建） */
  files: string[];
  /** CAPABILITIES.md diff 新增行（去 '+' 前缀；缺登记名单） */
  capAdded: string[];
  /** CAPABILITIES.md diff 删除行（去 '-' 前缀；幽灵剔除/计数更新等） */
  capRemoved: string[];
}

function git(projectPath: string, args: string[]): string {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * gate 前置校验：必须是 git 仓库且 HEAD 存在（vs HEAD 判定的前提），
 * 不满足（git 缺失 / 非仓库 / 无提交）抛 Error，由命令侧译成 usage-error。
 */
export function assertHeadGateEnv(projectPath: string): void {
  try {
    git(projectPath, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new Error('sync-docs --gate 需要 git 仓库且 HEAD 存在（vs HEAD 漂移判定）');
  }
}

/**
 * 判定被管理文档相对 HEAD 是否有变更。
 * `git status --porcelain` 同时覆盖 tracked 修改与 untracked 新建；
 * CAPABILITIES.md 有漂移时另取 diff 增删行作点名名单。
 */
export function diffManagedDocsAgainstHead(projectPath: string, managedFiles: string[]): HeadGateDrift {
  const status = git(projectPath, ['status', '--porcelain', '--', ...managedFiles]);
  const files = status.split('\n').filter(Boolean).map((line) => {
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4);
    return p;
  });

  const capAdded: string[] = [];
  const capRemoved: string[] = [];
  if (files.includes('CAPABILITIES.md')) {
    const diff = git(projectPath, ['diff', 'HEAD', '--', 'CAPABILITIES.md']);
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) capAdded.push(line.slice(1));
      else if (line.startsWith('-')) capRemoved.push(line.slice(1));
    }
  }
  return { files, capAdded, capRemoved };
}

/**
 * 从 CAPABILITIES.md diff 新增行提取缺登记名单：
 * 表格行取「文件」列（| 模块 | 文件 | 说明 |），非表格行（计数行等）取整行；
 * 表头行与 |---| 分隔行是排版、不是登记条目，滤除。
 */
export function missingRegistrationNames(addedLines: string[]): string[] {
  const names: string[] = [];
  for (const line of addedLines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('|')) {
      const cells = t.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))) continue; // 分隔行
      if (cells[0] === '模块' && cells[1] === '文件') continue; // 表头行
      names.push(cells[1] ?? t);
    } else {
      names.push(t);
    }
  }
  return [...new Set(names)];
}
