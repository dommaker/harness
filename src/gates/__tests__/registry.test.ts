/**
 * 门禁注册表测试（G1 闭环）
 */

import { GATE_DEFINITIONS, type GateDefinition } from '../definitions';
import {
  getGate,
  listRegisteredGates,
  registeredGateCount,
  assertGateRegistryClosed,
} from '../registry';
import { decisionFromResult } from '../decision';
import type { Gate } from '../types';

function fakeGate(id: string): Gate {
  return {
    id,
    order: 0,
    evaluate: async () =>
      decisionFromResult({
        gate: id,
        passed: true,
        message: 'ok',
        timestamp: new Date().toISOString(),
      }),
  };
}

describe('gateRegistry', () => {
  it('定义即注册：6 个门禁定义全部有实现', () => {
    expect(registeredGateCount()).toBe(6);
    for (const def of GATE_DEFINITIONS) {
      const gate = getGate(def.id);
      expect(gate).toBeDefined();
      expect(gate.id).toBe(def.id);
    }
  });

  it('注册实现携带定义表默认 order 与统一 evaluate', () => {
    for (const def of GATE_DEFINITIONS) {
      const gate = getGate(def.id);
      expect(gate.order).toBe(def.order);
      expect(typeof gate.evaluate).toBe('function');
    }
  });

  it('listRegisteredGates 返回副本且按定义序', () => {
    const gates = listRegisteredGates();
    expect(gates.map(g => g.id)).toEqual(GATE_DEFINITIONS.map(d => d.id));
    gates.pop();
    expect(listRegisteredGates()).toHaveLength(6);
  });

  it('定义无实现 → 抛错（闭环失败方向 1）', () => {
    const definitions: GateDefinition[] = [
      { id: 'orphan-def', description: 'x', order: 0, cli: { command: 'x', description: 'x', options: [], action: 'x', mapActionArgs: () => [] } },
    ];
    const implementations = [fakeGate('other')];
    expect(() => assertGateRegistryClosed(definitions, implementations)).toThrow(
      /门禁定义 "orphan-def" 未注册实现/
    );
  });

  it('实现无定义 → 抛错（闭环失败方向 2）', () => {
    const definitions: GateDefinition[] = [
      { id: 'defined', description: 'x', order: 0, cli: { command: 'x', description: 'x', options: [], action: 'x', mapActionArgs: () => [] } },
    ];
    const implementations = [fakeGate('defined'), fakeGate('undocumented-impl')];
    expect(() => assertGateRegistryClosed(definitions, implementations)).toThrow(
      /门禁实现 "undocumented-impl" 没有对应定义/
    );
  });

  it('重复 id → 抛错', () => {
    const definitions: GateDefinition[] = [
      { id: 'dup', description: 'x', order: 0, cli: { command: 'x', description: 'x', options: [], action: 'x', mapActionArgs: () => [] } },
    ];
    const implementations = [fakeGate('dup'), fakeGate('dup')];
    expect(() => assertGateRegistryClosed(definitions, implementations)).toThrow(
      /门禁 "dup" 重复注册/
    );
  });

  it('引用未注册 → getGate 抛错（闭环）', () => {
    expect(() => getGate('nonexistent')).toThrow(/门禁 "nonexistent" 未注册/);
  });
});
