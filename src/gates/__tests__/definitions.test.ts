/**
 * 门禁定义表闭环测试（定义↔实现）
 *
 * gates/registry.ts 已删除（三仓零生产消费者，重构班次 3 Phase 1）——原模块加载期
 * 双向闭环校验改由本测试断言承载，保护不降格、改形状：
 * - 定义无实现 / 实现无定义 / 重复 id → 测试红（原加载期抛错的两个方向）
 * - 每个 GateDefinition 的 CLI 实现引用（module+export）可解析
 *   （与 cli/commands/__tests__/registry.test.ts 对 COMMAND_DEFINITIONS 的断言同法）
 * - 实现满足统一 Gate 接口形状（id/order/evaluate）
 */

import { GATE_DEFINITIONS } from '../definitions';
import { SpecAcceptanceGate } from '../acceptance';
import { CommandGate } from '../command';
import { ContractGate } from '../contract';
import { PerformanceGate } from '../performance';
import { ReviewGate } from '../review';
import { SecurityGate } from '../security';
import type { Gate } from '../types';

const IMPLEMENTATIONS: Gate[] = [
  new SpecAcceptanceGate(),
  new CommandGate(),
  new ContractGate(),
  new PerformanceGate(),
  new ReviewGate(),
  new SecurityGate(),
];

describe('GATE_DEFINITIONS 定义↔实现闭环', () => {
  it('定义 id 唯一', () => {
    const ids = GATE_DEFINITIONS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个定义都有实现且 id 一致；每个实现都有定义（双向闭环）', () => {
    const implIds = IMPLEMENTATIONS.map(g => g.id);
    expect(new Set(implIds).size).toBe(implIds.length);
    for (const def of GATE_DEFINITIONS) {
      expect(implIds).toContain(def.id);
    }
    for (const id of implIds) {
      expect(GATE_DEFINITIONS.some(d => d.id === id)).toBe(true);
    }
  });

  it('实现满足统一 Gate 接口形状（id 非空 / order 数值 / evaluate 函数）', () => {
    for (const gate of IMPLEMENTATIONS) {
      expect(typeof gate.id).toBe('string');
      expect(gate.id.length).toBeGreaterThan(0);
      expect(typeof gate.order).toBe('number');
      expect(typeof gate.evaluate).toBe('function');
    }
  });

  it('每个定义的 CLI 实现引用（module+export）可解析', () => {
    const refs = GATE_DEFINITIONS.flatMap(def => [
      ...(def.cli.action ? [def.cli.action] : []),
      ...Object.values(def.cli.subcommands ?? {}).map(s => s.impl),
    ]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../../cli/commands/' + ref.module);
      if (typeof mod[ref.export] !== 'function') {
        throw new Error(`实现引用 ${ref.module}.${ref.export} 不存在或不是函数`);
      }
    }
  });
});
