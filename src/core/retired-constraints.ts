/**
 * 已退役约束清单（harness#188）
 *
 * `listRetiredConstraints(target)` 是 retired 墓碑的唯一公共读口：
 * config.yml `constraints.<id>` 中 `enabled: false` + `retired` 墓碑段
 * 在 mergeConstraints 时被滤出生效集，下游消费方（如路由层）列退役约束
 * 不再直读 `.harness/config.yml`。
 *
 * 墓碑口径与 retire/reactivate 的幂等判定同一处真相：
 * `enabled === false && retired` 存在才算退役——裸 enabled:false 是"禁用"
 * 不是"退休"（ADR-0032 决策 6.6），该谓词的唯一实现是本模块的
 * `isRetiredTombstone`，三处消费方共用。纯读 API，无闸门语义，不改任何文件。
 */

import { ProjectConfigLoader } from './project-config-loader';
import type { RunTarget } from './constraints/run-env';

/**
 * 退役墓碑元数据（constraints-retire 落盘形状）
 *
 * 字段全部可选：墓碑段可被手工编辑，读口不做严格校验，照原样透出。
 */
export interface RetiredConstraintMeta {
  /** 退役时间（ISO） */
  at?: string;
  /** 退役原因 */
  reason?: string;
  /** 退役时历史统计（来自 traces.log） */
  stats?: { total: number; fail: number; failRate: number };
}

/**
 * 一条已退役约束（config.yml `constraints.<id>` 墓碑段 + id）
 */
export interface RetiredConstraintEntry {
  id: string;
  /** 墓碑语义下恒为 false，透出供消费方直接序列化 */
  enabled: boolean;
  retired: RetiredConstraintMeta;
}

/**
 * retired 墓碑判定唯一实现（ADR-0032 决策 6.6）
 *
 * `enabled === false && retired` 存在才算退役；裸 enabled:false 是"禁用"
 * 不是"退休"。retire / reactivate 的幂等判定与本模块清单口径共用本谓词。
 */
export function isRetiredTombstone(
  entry: { enabled?: boolean; retired?: unknown } | undefined
): entry is { enabled: false; retired: unknown } {
  return entry?.enabled === false && Boolean(entry.retired);
}

/**
 * 列出项目已退役约束（retired 墓碑清单）
 *
 * 只认 retired 墓碑（判定谓词 = `isRetiredTombstone`）；
 * 裸禁用与未配置条目不入选。无 config.yml / 无 constraints 段时返回空数组。
 * 返回顺序 = config.yml 条目顺序（YAML 解析保序）。
 *
 * @param target 项目根路径，或本 run 的运行级观察面（无 cwd 默认值，
 *   与同族访问器 `getGovernanceConfig` 同形——cwd 兜底只在 CLI 入口做一次，harness#95/#192）
 *   传观察面 = config.yml 读取与本 run 其余消费方共用同一份（ADR-0023 决策 2）
 */
export function listRetiredConstraints(target: RunTarget): RetiredConstraintEntry[] {
  const loader = new ProjectConfigLoader(target);
  loader.load();
  const constraints = loader.getConfig().constraints ?? {};
  const entries: RetiredConstraintEntry[] = [];
  for (const [id, raw] of Object.entries(constraints)) {
    const entry = raw as { enabled?: boolean; retired?: unknown } | undefined;
    if (isRetiredTombstone(entry)) {
      entries.push({ id, enabled: entry.enabled, retired: entry.retired as RetiredConstraintMeta });
    }
  }
  return entries;
}
