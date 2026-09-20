/**
 * 生效约束集（ADR-0029，链路承自 ADR-0001）
 *
 * `getEffectiveConstraints(projectRoot)` 是全仓唯一的生效集来源：
 * 内置 → preset → config.yml 禁用。
 * `harness check`、外部消费者（studio 等）全部消费它，
 * 不再直接读 CONSTRAINTS 全集。
 */

import type { Constraint } from '../types/constraint';
import type { MergedConstraintsConfig } from '../types/project-config';
import { ProjectConfigLoader } from './project-config-loader';
import type { RunTarget } from './constraints/run-env';

/**
 * 获取项目当前生效的约束集（check 全量，带 kind/severity）
 *
 * 生效集链路同 getMergedConstraintsConfig：内置 → preset 裁剪 → config.yml
 * `constraints.<id>.enabled:false` 删除。
 *
 * @param target 项目根路径，或本 run 的运行级观察面（缺省 process.cwd()）
 *   传观察面 = config.yml 读取与本 run 其余消费方共用同一份（ADR-0023 决策 2）
 * @param options.preset 覆盖 config.yml 的 preset；仅在项目无自定义配置时生效
 *   （与 getMergedConstraintsConfig 同一优先级规则），不传则尊重 config.yml
 */
export function getEffectiveConstraints(
  target: RunTarget = process.cwd(),
  options?: { preset?: string }
): Constraint[] {
  return constraintsFromMerged(getMergedConstraintsConfig(target, options));
}

/**
 * 从已算好的合并配置取出生效集清单（与 getEffectiveConstraints 同一形状）
 *
 * 给已经持有 `MergedConstraintsConfig` 的消费方复用（CLI check 复用这一份，
 * 避免生效集链路在一次运行里算两遍，ADR-0023 步骤 4.5）。
 */
export function constraintsFromMerged(merged: MergedConstraintsConfig): Constraint[] {
  return Object.values(merged.constraints);
}

/**
 * 获取项目当前生效的合并约束配置（唯一来源的完整形状）
 *
 * 与 getEffectiveConstraints 同一生效集链路，返回完整 MergedConstraintsConfig
 * （含 disabled/unknownIds），供 check 等需要诊断信息的消费方使用。
 *
 * options.preset（CLI --preset）仅在项目无自定义配置时覆盖 config.yml 的
 * preset（工单 23 语义：项目自定义配置优先于 CLI 预设）；不传 preset 时
 * 完全尊重 config.yml 的 preset 键。
 *
 * @param target 项目根路径，或本 run 的运行级观察面（缺省 process.cwd()）
 */
export function getMergedConstraintsConfig(
  target: RunTarget = process.cwd(),
  options?: { preset?: string }
): MergedConstraintsConfig {
  const loader = new ProjectConfigLoader(target);
  loader.load();
  if (loader.hasCustomConfig() || !options?.preset) {
    return loader.mergeConstraints();
  }
  return loader.mergeConstraints({ preset: options.preset });
}

/**
 * 生效集配置诊断结果
 */
export interface EffectiveConfigLint {
  /**
   * config.yml `constraints.<id>` 中非内置的未知 id
   * （如禁用了已被本版移除的约束的残留配置）。生效集计算静默忽略，
   * 在此列出供 report 提示。
   */
  unknownIds: string[];
}

/**
 * 诊断项目约束配置：未知 id 残留
 *
 * 不抛错、不修改任何文件，供 report / check 的诊断输出使用。
 *
 * @param projectRoot 项目根路径（缺省 process.cwd()）
 */
export function lintEffectiveConfig(projectRoot: string = process.cwd()): EffectiveConfigLint {
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const merged = loader.mergeConstraints();
  return {
    unknownIds: merged.unknownIds ?? [],
  };
}
