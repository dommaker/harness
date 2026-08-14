/**
 * 生效约束集（ADR-0001）
 *
 * `getEffectiveConstraints(projectRoot)` 是全仓唯一的生效集来源：
 * 内置 → preset → config.yml 禁用 → custom 追加 → scenes 过滤。
 * init 注入、`harness check`、外部消费者（studio 等）全部消费它，
 * 不再直接读 IRON_LAWS/GUIDELINES/PROMPTS 全集。
 */

import type { Constraint } from '../types/constraint';
import { PROMPTS } from './constraints/definitions';
import { ProjectConfigLoader } from './project-config-loader';

/**
 * 获取项目当前生效的约束集（check + prompt，带 kind）
 *
 * 内部完成完整合并：内置 → preset 裁剪 → config.yml `constraints.<id>.enabled:false`
 * 删除（内置与 custom 同效）→ custom-constraints 追加/extend_exceptions
 * （被禁用的 custom 不追加）→ scenes 过滤
 * （带 appliesTo 的 prompt 仅当 config.yml `scenes` 与其交集非空时保留，
 * 缺省 scenes=[] 即场景专属 prompt 默认不进入生效集）。
 *
 * @param projectRoot 项目根路径（缺省 process.cwd()）
 */
export function getEffectiveConstraints(projectRoot: string = process.cwd()): Constraint[] {
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const merged = loader.mergeConstraints();
  return [
    ...Object.values(merged.ironLaws),
    ...Object.values(merged.guidelines),
    ...Object.values(merged.tips),
    ...Object.values(merged.prompts ?? {}),
  ];
}

/**
 * 生效集配置诊断结果
 */
export interface EffectiveConfigLint {
  /**
   * config.yml `constraints.<id>` 中既非内置也非自定义的未知 id
   * （如禁用了已被本版移除的约束的残留配置）。生效集计算静默忽略，
   * 在此列出供 report 提示。
   */
  unknownIds: string[];

  /** 项目配置的场景标签（config.yml `scenes`，缺省 []） */
  scenes: string[];

  /**
   * 因 scenes 过滤而未进入生效集的场景专属 prompt id
   * （已被 preset/config 禁用的不重复列出）
   */
  sceneExcluded: string[];
}

/**
 * 诊断项目约束配置：未知 id 残留、scenes 生效情况
 *
 * 不抛错、不修改任何文件，供 report / check 的诊断输出使用。
 *
 * @param projectRoot 项目根路径（缺省 process.cwd()）
 */
export function lintEffectiveConfig(projectRoot: string = process.cwd()): EffectiveConfigLint {
  const loader = new ProjectConfigLoader(projectRoot);
  const config = loader.load();
  const merged = loader.mergeConstraints();
  const scenes = config.scenes ?? [];

  const sceneExcluded = Object.values(PROMPTS)
    .filter(
      c =>
        c.appliesTo &&
        c.appliesTo.length > 0 &&
        !c.appliesTo.some(scene => scenes.includes(scene)) &&
        !merged.disabled.includes(c.id)
    )
    .map(c => c.id);

  return {
    unknownIds: merged.unknownIds ?? [],
    scenes,
    sceneExcluded,
  };
}
