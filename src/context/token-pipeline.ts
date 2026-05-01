/**
 * Token 流水线
 *
 * 五步：收集 → 排序 → 压缩 → 预算 → 组装
 * 每次 LLM 调用前运行
 */

import { TokenEstimator, TokenBudget } from './token-budget';
import type {
  ContextSource,
  TokenBudgetAllocation,
  PipelineInput,
  PipelineOutput,
  ContextUsageSnapshot,
} from './types';

interface CollectedGroup {
  priority: number;
  sources: ContextSource[];
}

export class TokenPipeline {
  /**
   * 完整流水线：收集 → 排序 → 压缩 → 预算 → 组装
   */
  run(input: PipelineInput): PipelineOutput {
    const { sources, budget } = input;

    // Step 1: 收集 — 按 priority 分组
    const collected = this.collect(sources);

    // Step 2: 排序 — 按 P1→P6 排序
    const sorted = this.sort(collected);

    // Step 3: 压缩 — 对 P3-P5 应用预算裁剪
    const { compressed, dropped } = this.compress(sorted, budget);

    // Step 4: 预算 — 按分配裁剪
    const budgeted = this.applyBudget(compressed, budget);

    // Step 5: 组装 — 拼装最终 prompt
    const prompt = this.assemble(budgeted);

    // 生成快照
    const snapshot = this.buildSnapshot(budgeted, dropped);

    return { prompt, snapshot, dropped };
  }

  /**
   * Step 1: 收集 — 从 sources 按 priority 分组
   */
  collect(sources: ContextSource[]): CollectedGroup[] {
    const groups = new Map<number, ContextSource[]>();

    for (const source of sources) {
      const existing = groups.get(source.priority) || [];
      existing.push(source);
      groups.set(source.priority, existing);
    }

    return Array.from(groups.entries())
      .map(([priority, sources]) => ({ priority, sources }))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Step 2: 排序 — 按 P1→P6，组内保持原序
   */
  sort(groups: CollectedGroup[]): ContextSource[] {
    const sorted: ContextSource[] = [];

    for (const group of groups) {
      sorted.push(...group.sources);
    }

    return sorted;
  }

  /**
   * Step 3: 压缩 — 对 P3-P5 应用 token 预算裁剪
   *
   * P1（系统提示词）和 P6（用户消息）不压缩
   * P2（工具定义）按需懒加载，这里不处理
   */
  compress(sorted: ContextSource[], budget: TokenBudgetAllocation): {
    compressed: ContextSource[];
    dropped: Array<{ type: string; id: string; reason: string }>;
  } {
    const compressed: ContextSource[] = [];
    const dropped: Array<{ type: string; id: string; reason: string }> = [];

    // 各段预算
    const budgetMap: Record<number, number> = {
      1: budget.systemPrompt,
      2: budget.toolDefinitions,
      3: budget.knowledge,
      4: budget.notes,
      5: budget.history,
      6: Infinity, // 用户消息不限
    };

    // 按优先级分组处理
    const byPriority = new Map<number, ContextSource[]>();
    for (const item of sorted) {
      const existing = byPriority.get(item.priority) || [];
      existing.push(item);
      byPriority.set(item.priority, existing);
    }

    for (const [priority, items] of byPriority) {
      const sectionBudget = budgetMap[priority] || budget.history;

      if (priority === 1 || priority === 6) {
        // P1/P6 不压缩
        compressed.push(...items);
        continue;
      }

      // 按 token 预算裁剪
      let usedTokens = 0;
      for (const item of items) {
        const tokens = TokenEstimator.estimateText(item.content);

        if (usedTokens + tokens <= sectionBudget) {
          compressed.push(item);
          usedTokens += tokens;
        } else {
          // 尝试截断
          const remaining = sectionBudget - usedTokens;
          if (remaining > 50) {
            const ratio = remaining / tokens;
            const truncatedContent = item.content.slice(0, Math.floor(item.content.length * ratio));
            compressed.push({ ...item, content: truncatedContent });
            dropped.push({
              type: item.type,
              id: item.id,
              reason: `截断: ${tokens} → ${Math.floor(tokens * ratio)} tokens`,
            });
          } else {
            dropped.push({
              type: item.type,
              id: item.id,
              reason: `超出预算: 需要 ${tokens} tokens，剩余 ${remaining}`,
            });
          }
          usedTokens += tokens; // 仍然计入已用
        }
      }
    }

    return { compressed, dropped };
  }

  /**
   * Step 4: 预算 — 按 TokenBudgetAllocation 分配各段
   */
  applyBudget(compressed: ContextSource[], budget: TokenBudgetAllocation): ContextSource[] {
    const tokenBudget = new TokenBudget(budget.total);
    const result: ContextSource[] = [];

    for (const item of compressed) {
      const tokens = TokenEstimator.estimateText(item.content);

      if (tokenBudget.canAfford(tokens)) {
        tokenBudget.consume(tokens);
        result.push(item);
      } else if (item.priority === 1 || item.priority === 6) {
        // P1/P6 强制保留
        tokenBudget.forceConsume(tokens);
        result.push(item);
      }
      // 其他优先级的超预算项被丢弃
    }

    return result;
  }

  /**
   * Step 5: 组装 — 拼装最终 prompt
   *
   * P1 开头 + P6 结尾，中间 P2-P5
   */
  assemble(budgeted: ContextSource[]): string {
    const sections: Record<number, string[]> = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
    };

    for (const item of budgeted) {
      sections[item.priority] = sections[item.priority] || [];
      sections[item.priority].push(item.content);
    }

    const parts: string[] = [];

    // P1: 系统提示词（开头）
    if (sections[1].length > 0) {
      parts.push(sections[1].join('\n'));
    }

    // P2-P5: 中间部分
    for (const priority of [2, 3, 4, 5]) {
      if (sections[priority].length > 0) {
        parts.push(sections[priority].join('\n'));
      }
    }

    // P6: 用户消息（结尾）
    if (sections[6].length > 0) {
      parts.push(sections[6].join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * 构建上下文使用快照
   */
  private buildSnapshot(budgeted: ContextSource[], dropped: Array<{ type: string; id: string; reason: string }>): ContextUsageSnapshot {
    const breakdown = {
      systemPrompt: 0,
      messages: 0,
      toolOutputs: 0,
      knowledge: 0,
      other: 0,
    };

    for (const item of budgeted) {
      const tokens = TokenEstimator.estimateText(item.content);

      switch (item.type) {
        case 'system_prompt':
          breakdown.systemPrompt += tokens;
          break;
        case 'user_message':
        case 'session_event':
          breakdown.messages += tokens;
          break;
        case 'tool_output':
        case 'tool_definition':
          breakdown.toolOutputs += tokens;
          break;
        case 'knowledge':
          breakdown.knowledge += tokens;
          break;
        default:
          breakdown.other += tokens;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalTokens: breakdown.systemPrompt + breakdown.messages + breakdown.toolOutputs + breakdown.knowledge + breakdown.other,
      breakdown,
      truncatedItems: dropped.filter(d => d.reason.startsWith('截断')).map(d => ({
        type: d.type,
        id: d.id,
        originalTokens: 0,
        keptTokens: 0,
      })),
      offloadedItems: [],
      compactionTriggered: false,
    };
  }
}
