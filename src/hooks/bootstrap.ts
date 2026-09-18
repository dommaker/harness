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
 */

import { ConstraintChecker } from '../core/constraints/checker';
import { SessionManager } from '../context/session-manager';
import { ProjectConfigLoader } from '../core/project-config-loader';
import { TraceCollector } from '../monitoring/traces';
import type { MergedConstraintsConfig } from '../types/project-config';

/**
 * 异步加载项目配置（S9：异步 I/O）
 */
async function loadConfigAsync(projectPath: string): Promise<{
  config: ReturnType<ProjectConfigLoader['getConfig']>;
  mergedConstraints: MergedConstraintsConfig;
}> {
  // config.yml 的读取只有 loadRawProjectConfig 这一条路（ADR-0023 决策 2 撤销进程级
  // 缓存后，每次调用读当下内容），此处不重复读文件
  const loader = new ProjectConfigLoader(projectPath);
  loader.load();

  return {
    config: loader.getConfig(),
    mergedConstraints: loader.mergeConstraints(),
  };
}

/**
 * Bootstrap 结果
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
 * 初始化 harness 运行环境（异步，不阻塞事件循环）
 *
 * @param projectPath 项目根路径
 */
export async function bootstrapHarness(
  projectPath?: string
): Promise<HarnessBootstrap> {
  const resolvedPath = projectPath || process.cwd();

  // 1. 异步加载配置（S9 fix）
  const { mergedConstraints } = await loadConfigAsync(resolvedPath);

  // 2. 初始化核心组件
  // trace 记录器锚根构造（#139）：本函数本就收 projectPath，落点必须跟着根走
  const checker = new ConstraintChecker(new TraceCollector({ projectPath: resolvedPath }));

  const sessions = new SessionManager(resolvedPath);

  return {
    checker,
    sessions,
    projectPath: resolvedPath,
    mergedConstraints,
  };
}

/**
 * 同步 bootstrap（兼容不支持 top-level await 的环境）
 *
 * 配置加载仍为同步（readFileSync），其他组件初始化同上。
 *
 * @param projectPath 项目根路径
 */
export function bootstrapHarnessSync(
  projectPath?: string
): HarnessBootstrap {
  const resolvedPath = projectPath || process.cwd();

  const loader = new ProjectConfigLoader(resolvedPath);
  loader.load();
  const mergedConstraints = loader.mergeConstraints();

  const checker = new ConstraintChecker(new TraceCollector({ projectPath: resolvedPath }));

  const sessions = new SessionManager(resolvedPath);

  return {
    checker,
    sessions,
    projectPath: resolvedPath,
    mergedConstraints,
  };
}
