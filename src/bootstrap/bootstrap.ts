/**
 * Harness Bootstrap — 统一初始化入口（Phase 1）
 *
 * 解决：
 * - S9: ProjectConfigLoader 异步加载，不阻塞事件循环
 * - S2: 提供单例 SessionManager 生命周期管理
 *
 * Consumer 用法：
 * ```typescript
 * const harness = await bootstrapHarness('/path/to/project');
 * // harness.checker, harness.sessions, harness.mergedConstraints
 * ```
 *
 * checker 的 trace 记录器在此接线（harness#88：core 不上行依赖 monitoring），
 * 且锚在本函数收到的 projectPath 上（#139：落点跟根走，不落调用方 cwd）。
 *
 * ADR-0027（#170）：hooks 管线面（registry/pipeline/config/types）双仓零生产消费者，
 * 整体删除；本层的 `hookDefinitions` / `hookConfigs` 两参数与 `hooks` / `pipeline`
 * 两字段随之消失——生产唯一调用方本就无参调用、不访问被删字段。
 *
 * ADR-0040 Phase 3：目录正名 `hooks/` → `bootstrap/`（职责是组合根，目录名不再沿用
 * 历史）；`loadConfigAsync` 假 async（async 壳包纯同步调用）改同步 `loadConfig`，
 * 两个入口的逐字重复装配并为一枚 `assembleHarness`。
 */

import { ConstraintChecker } from '../core/constraints/checker';
import { SessionManager } from '../context/session-manager';
import { ProjectConfigLoader } from '../core/project-config-loader';
import { TraceCollector } from '../monitoring/traces';
import type { MergedConstraintsConfig } from '../types/project-config';

/**
 * 加载项目配置与合并约束（同步：readFileSync；原 loadConfigAsync 是 async 壳包纯同步调用）
 *
 * config.yml 的读取只有 loadRawProjectConfig 这一条路（ADR-0023 决策 2 撤销进程级
 * 缓存后，每次调用读当下内容），此处不重复读文件
 */
function loadConfig(projectPath: string): {
  config: ReturnType<ProjectConfigLoader['getConfig']>;
  mergedConstraints: MergedConstraintsConfig;
} {
  const loader = new ProjectConfigLoader(projectPath);
  loader.load();

  return {
    config: loader.getConfig(),
    mergedConstraints: loader.mergeConstraints(),
  };
}

/**
 * Bootstrap 结果
 *
 * 生产调用方（下游消费方经其共享包）无参调用、只以类型持有本形状，从不读字段——
 * 调用是纯为副作用（装配 + trace 接线）；字段形状由编译期钉与
 * __tests__/bootstrap.test.ts 冻结，不随「无人读」收窄。
 */
export interface HarnessBootstrap {
  /** 约束检查器 */
  checker: ConstraintChecker;
  /** 会话管理器 */
  sessions: SessionManager;
  /** 项目路径 */
  projectPath: string;
  /** 合并后的约束配置 */
  mergedConstraints: MergedConstraintsConfig;
}

/**
 * 装配 harness 运行环境（两个入口共用的一段）：
 * trace 记录器锚根构造（#139）：入口本就收 projectPath，落点必须跟着根走
 */
function assembleHarness(resolvedPath: string, mergedConstraints: MergedConstraintsConfig): HarnessBootstrap {
  return {
    checker: new ConstraintChecker(new TraceCollector({ projectPath: resolvedPath })),
    sessions: new SessionManager(resolvedPath),
    projectPath: resolvedPath,
    mergedConstraints,
  };
}

/**
 * 初始化 harness 运行环境（异步面：配置读取是同步 fs，async 仅为公共签名兼容）
 *
 * @param projectPath 项目根路径
 */
export async function bootstrapHarness(
  projectPath?: string
): Promise<HarnessBootstrap> {
  const resolvedPath = projectPath || process.cwd();
  const { mergedConstraints } = loadConfig(resolvedPath);
  return assembleHarness(resolvedPath, mergedConstraints);
}

/**
 * 同步 bootstrap（兼容不支持 top-level await 的环境）
 *
 * @param projectPath 项目根路径
 */
export function bootstrapHarnessSync(
  projectPath?: string
): HarnessBootstrap {
  const resolvedPath = projectPath || process.cwd();
  const { mergedConstraints } = loadConfig(resolvedPath);
  return assembleHarness(resolvedPath, mergedConstraints);
}
