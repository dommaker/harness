/**
 * init 的 CI 平台解析（harness#143；Phase 3 自 init.ts 拆出，纯移位）
 *
 * 解析链 = flag > config.yml 的 `ci.platform` > `github`。
 */

import { attempt } from '../../../utils/attempt';
import { loadRawProjectConfig } from '../../../core/project-config-loader';
import type { CiConfig, CiPlatform } from '../../../types/project-config';

/** `--ci` 的可取值域（`none` = 不创建任何服务端 CI 文件，治理 CI 面亦不建，即旧 `--no-github-actions`） */
const CI_FLAG_VALUES: Array<CiPlatform | 'none'> = ['github', 'gitlab', 'none'];

/** CI 平台解析结果（`error` 属用法错误，命令层直接非零退出，不落任何文件） */
export type CiResolution =
  | { kind: 'ok'; platform: CiPlatform | 'none'; warning?: string }
  | { kind: 'error'; reason: string };

/**
 * 解析 CI 平台（harness#143 决议 ①④）：flag > config.yml 的 `ci.platform` > `github`
 *
 * 不做 remote URL 自动检测：init 常跑在首次 push 之前无 remote 可测，而检测错的代价是
 * 静默写错文件。`--no-github-actions` 保留为 `--ci none` 的废弃别名；它与显式
 * `--ci <非 none>` 同时出现时不猜用户意图，判用法错误。
 */
export function resolveCiPlatform(
  options: { ci?: CiPlatform | 'none'; githubActions?: boolean },
  configured: CiPlatform | 'none' | undefined,
): CiResolution {
  const flag = options.ci;
  if (flag !== undefined && !CI_FLAG_VALUES.includes(flag)) {
    return {
      kind: 'error',
      reason: `--ci 取值非法: ${String(flag)}（可取 ${CI_FLAG_VALUES.join(' | ')}）`,
    };
  }
  if (options.githubActions === false) {
    if (flag !== undefined && flag !== 'none') {
      return {
        kind: 'error',
        reason: `--ci ${flag} 与 --no-github-actions（即 --ci none 的废弃别名）冲突，二选一`,
      };
    }
    return {
      kind: 'ok',
      platform: 'none',
      warning: '⚠️  --no-github-actions 已废弃，请改用 --ci none',
    };
  }
  return { kind: 'ok', platform: flag ?? configured ?? 'github' };
}

/**
 * 读 config.yml 已持久化的 `ci.platform`（解析链第二级）
 *
 * 缺失 / 形状不符一律按未配置处理；config.yml 解析失败经 attempt 显式降级为未配置——
 * init 是用户首次上手入口，存量脏配置不该炸掉初始化（解析失败会真实抛到用户眼前的
 * 场景是 check/sync-docs 等执法面，那里不兜）。
 */
export function readConfiguredCiPlatform(projectPath: string): CiPlatform | 'none' | undefined {
  const raw = attempt(() => loadRawProjectConfig(projectPath), () => undefined);
  const ci = raw?.ci;
  if (ci === null || typeof ci !== 'object') return undefined;
  const platform = (ci as CiConfig).platform;
  return platform !== undefined && CI_FLAG_VALUES.includes(platform) ? platform : undefined;
}
