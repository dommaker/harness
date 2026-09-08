/**
 * AcceptanceGate 类型单一正本（harness#101，架构评审 A1）
 *
 * 钉住三条：
 * 1. 公共导出面（gates/types.ts）的 SpecAcceptanceGateConfig 并入 e2e 字段——
 *    修前窄版会在类型层面拒绝 e2eTestCommand/e2eTestTimeout/projectPath（编译即红）。
 * 2. 测试与公共面走同一 seam：工厂从 gates/index 取，acceptance.ts 侧工厂已删。
 * 3. acceptance.ts 不再持有三类型/工厂的双份定义（源码扫描闸，防双正本回潮）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { SpecAcceptanceGate, createSpecAcceptanceGate } from '../index';
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

  it('gates/index 工厂接受并入后的宽版配置（与公共面同一 seam）', () => {
    const gate = createSpecAcceptanceGate({
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
