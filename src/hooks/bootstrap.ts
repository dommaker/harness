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
 * // harness.checker, harness.config, harness.hooks, harness.sessions
 * ```
 */

import { ConstraintChecker } from '../core/constraints/checker';
import { getTraceCollector } from '../monitoring/traces';
import { SessionManager } from '../context/session-manager';
import { ProjectConfigLoader } from '../core/project-config-loader';
import { HookRegistry } from './registry';
import { HookPipeline } from './pipeline';
import type { MergedConstraintsConfig } from '../types/project-config';
import type { HookDefinition } from './types';

/**
 * 异步加载项目配置（S9：异步 I/O）
 */
async function loadConfigAsync(projectPath: string): Promise<{
  config: ReturnType<ProjectConfigLoader['getConfig']>;
  mergedConstraints: MergedConstraintsConfig;
}> {
  // config.yml 解析经 loadRawProjectConfig 进程级 memoize（工单 16），
  // 此处不再重复读取文件
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
  /** Hook 注册表 */
  hooks: HookRegistry;
  /** Hook 管线 */
  pipeline: HookPipeline;
  /** 项目路径 */
  projectPath: string;
  /** 合并后的约束配置 */
  mergedConstraints: MergedConstraintsConfig;
}

/**
 * 初始化 harness 运行环境（异步，不阻塞事件循环）
 *
 * @param projectPath 项目根路径
 * @param hookDefinitions 可选，初始化时注册的 hook
 */
export async function bootstrapHarness(
  projectPath?: string,
  hookDefinitions?: HookDefinition[]
): Promise<HarnessBootstrap> {
  const resolvedPath = projectPath || process.cwd();

  // 1. 异步加载配置（S9 fix）
  const { mergedConstraints } = await loadConfigAsync(resolvedPath);

  // 2. 初始化核心组件
  const checker = ConstraintChecker.getInstance();
  checker.setCustomConfig(mergedConstraints);
  checker.setTraceRecorder(getTraceCollector());

  const sessions = new SessionManager(resolvedPath);
  const hooks = new HookRegistry();
  const pipeline = new HookPipeline(hooks);

  // 3. 注册初始 hook
  if (hookDefinitions) {
    hooks.registerAll(hookDefinitions);
  }

  return {
    checker,
    sessions,
    hooks,
    pipeline,
    projectPath: resolvedPath,
    mergedConstraints,
  };
}

/**
 * 同步 bootstrap（兼容不支持 top-level await 的环境）
 *
 * 配置加载仍为同步（readFileSync），其他组件初始化同上。
 */
export function bootstrapHarnessSync(
  projectPath?: string,
  hookDefinitions?: HookDefinition[]
): HarnessBootstrap {
  const resolvedPath = projectPath || process.cwd();

  const loader = new ProjectConfigLoader(resolvedPath);
  loader.load();
  const mergedConstraints = loader.mergeConstraints();

  const checker = ConstraintChecker.getInstance();
  checker.setCustomConfig(mergedConstraints);
  checker.setTraceRecorder(getTraceCollector());

  const sessions = new SessionManager(resolvedPath);
  const hooks = new HookRegistry();
  const pipeline = new HookPipeline(hooks);

  if (hookDefinitions) {
    hooks.registerAll(hookDefinitions);
  }

  return {
    checker,
    sessions,
    hooks,
    pipeline,
    projectPath: resolvedPath,
    mergedConstraints,
  };
}
