/**
 * AcceptanceGate 类型单一正本（harness#101，架构评审 A1）
 *
 * 钉住三条：
 * 1. 类型面（gates/types.ts）的 SpecAcceptanceGateConfig 并入 e2e 字段——
 *    修前窄版会在类型层面拒绝 e2eTestCommand/e2eTestTimeout/projectPath（编译即红）。
 * 2. acceptance.ts 不再持有三类型/工厂的双份定义（源码扫描闸，防双正本回潮）。
 * （原「工厂与公共面同一 seam」一条随 #199 入口清空失效——内联工厂已删，
 *   等价构造直走 `new SpecAcceptanceGate(...)`，配置形状不变）
 */

import * as fs from 'fs';
import * as path from 'path';
import { SpecAcceptanceGate } from '../acceptance';
import type {
  SpecAcceptanceGateConfig,
  AcceptanceGateContext,
  AcceptanceCriteria,
} from '../types';

describe('AcceptanceGate 类型单一正本（#101）', () => {
  it('公共面 SpecAcceptanceGateConfig 接受 e2eTestCommand/e2eTestTimeout/projectPath', () => {
    const config: SpecAcceptanceGateConfig = {
      tasksPath: 'tasks.yml',
      checkAllTasks: true,
      e2eTestCommand: 'npx playwright test',
      e2eTestTimeout: 60000,
      projectPath: '/tmp/proj',
    };
    expect(config.e2eTestCommand).toBe('npx playwright test');
    expect(config.e2eTestTimeout).toBe(60000);
    expect(config.projectPath).toBe('/tmp/proj');
  });

  it('公共面 AcceptanceGateContext / AcceptanceCriteria 形状不变', () => {
    const context: AcceptanceGateContext = {
      projectPath: '/tmp/proj',
      taskId: 'TASK-001',
      tasksPath: 'tasks.yml',
    };
    const criteria: AcceptanceCriteria = {
      id: 'AC-1',
      description: 'desc',
      type: 'automated',
      required: true,
      checked: true,
      notes: 'n',
    };
    expect(context.projectPath).toBe('/tmp/proj');
    expect(criteria.type).toBe('automated');
  });

  it('宽版配置（含 e2e 字段）可直接构造（与收回前公共面同一形状）', () => {
    const gate = new SpecAcceptanceGate({
      e2eTestCommand: 'npx playwright test',
      e2eTestTimeout: 60000,
      projectPath: '/tmp/proj',
    });
    expect(gate).toBeInstanceOf(SpecAcceptanceGate);
  });

  it('acceptance.ts 不再持有三类型与工厂的双份定义', () => {
    const source = fs.readFileSync(path.join(__dirname, '../acceptance.ts'), 'utf-8');
    expect(source).not.toMatch(
      /export interface (SpecAcceptanceGateConfig|AcceptanceGateContext|AcceptanceCriteria)\b/,
    );
    expect(source).not.toMatch(/export function createSpecAcceptanceGate\b/);
  });
});
