/**
 * changelog_version 检查（自 runner.ts 拆出，重构班次 3 Phase 4）
 *
 * CHANGELOG 最新版本号与 package.json version 一致性。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ChangelogVersionCheck } from '../../../types/project-config';
import type { FreshnessCheckResult, RunContext } from './runner';

export function checkChangelogVersion(
  check: ChangelogVersionCheck,
  ctx: RunContext
): FreshnessCheckResult {
  const changelogPath = join(ctx.projectPath, check.changelog || 'CHANGELOG.md');
  const pkgPath = join(ctx.projectPath, check.package_json || 'package.json');

  // fail-fast：缺文件/缺版本行是「无检查对象」按 pass 跳过（下方显式分支）；
  // 读失败、package.json 损坏等真异常直接抛，由 checker 层按可见降级处理，
  // 不再 catch 成静默 pass（吞错会把解析 bug 变成「永远通过」，harness#119）
  if (!existsSync(changelogPath)) {
    return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
  }

  const changelogContent = readFileSync(changelogPath, 'utf-8');
  const versionMatch = changelogContent.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
  if (!versionMatch) {
    return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
  }

  const changelogVersion = versionMatch[1];

  if (!existsSync(pkgPath)) {
    return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const pkgVersion = pkg.version as string;

  const pass = changelogVersion === pkgVersion;
  return {
    type: 'changelog_version',
    label: 'CHANGELOG Version',
    pass,
    message: pass ? undefined : `CHANGELOG.md 版本 ${changelogVersion} !== package.json 版本 ${pkgVersion}`,
    detail: { changelogVersion, pkgVersion },
  };
}
