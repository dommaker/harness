/**
 * Dashboard 数据聚合
 *
 * 从各模块收集数据，生成 HarnessDashboardData
 * 纯文件读取，零 token 开销
 */

import type {
  HarnessDashboardData,
  KnowledgeOverview,
  ConstraintHeatmap,
  KnowledgeFlow,
  FeedbackLoopStatus,
  ConstraintStats,
  ConstraintLayer,
} from './types';
import type { KnowledgeEntry } from '../knowledge/types';
import { computeKnowledgeOverview, computeKnowledgeFlow, computeInterceptRate } from './stats';
import { getAllConstraints } from '../core/constraints/definitions';

export class DashboardDataProvider {
  /**
   * 生成完整 Dashboard 数据
   */
  generate(
    entries: KnowledgeEntry[],
    constraintStats: ConstraintStats[] = [],
    referenceCounts: Map<string, number> = new Map(),
  ): HarnessDashboardData {
    return {
      timestamp: new Date().toISOString(),
      knowledgeOverview: this.getKnowledgeOverview(entries),
      constraintHeatmap: this.getConstraintHeatmap(constraintStats),
      knowledgeFlow: this.getKnowledgeFlow(entries, referenceCounts),
      feedbackLoop: this.getFeedbackLoop(),
    };
  }

  /**
   * 知识库全景
   */
  getKnowledgeOverview(entries: KnowledgeEntry[]): KnowledgeOverview {
    return computeKnowledgeOverview(entries);
  }

  /**
   * 约束执行热力图
   */
  getConstraintHeatmap(stats: ConstraintStats[]): ConstraintHeatmap {
    // P1：直接读 definitions；prompt 类不产生 trace 统计，热力图只含 check 层
    const allConstraints = getAllConstraints().filter(c => c.kind === 'check');

    const constraints = allConstraints.map(c => {
      const stat = stats.find(s => s.constraintId === c.id);
      const layer: ConstraintLayer = c.level === 'iron_law' ? 'safety' : 'quality';
      return {
        id: c.id,
        layer,
        trigger: stat?.triggerCount ?? 0,
        pass: stat?.passCount ?? 0,
        intercept: stat?.interceptCount ?? 0,
        interceptRate: stat ? computeInterceptRate(stat.triggerCount, stat.interceptCount) : 0,
        deprecationStatus: 'active' as const,
        permanent: false,
      };
    });

    const neverTriggered = constraints.filter(c => c.trigger === 0).map(c => c.id);

    const decliningInterceptRate = constraints
      .filter(c => c.interceptRate > 0 && c.interceptRate < 15)
      .map(c => ({ id: c.id, from: c.interceptRate, to: c.interceptRate }));

    return {
      period: '近 30 天',
      constraints,
      neverTriggered,
      decliningInterceptRate,
    };
  }

  /**
   * 知识流转路径
   */
  getKnowledgeFlow(
    entries: KnowledgeEntry[],
    referenceCounts: Map<string, number>,
  ): KnowledgeFlow {
    return computeKnowledgeFlow(entries, referenceCounts);
  }

  /**
   * 反馈环状态（基础实现，需要外部数据源补充）
   */
  getFeedbackLoop(): FeedbackLoopStatus {
    return {
      local: { active: 0 },
      push: { active: 0 },
      external: { active: 0 },
      feedbackToKnowledge: { total: 0, pending: 0 },
    };
  }
}
