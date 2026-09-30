/**
 * AcceptanceGate 类型单一正本（harness#101，架构评审 A1）
 *
 * 钉住三条：
 * 1. 类型面（gates/types.ts）的 SpecAcceptanceGateConfig 并入 e2e 字段——
 *    修前窄版会在类型层面拒绝 e2eTestCommand/e2eTestTimeout/projectPath（编译即红）。
 * 2. acceptance.ts 不再持有两类型/工厂的双份定义（源码扫描闸，防双正本回潮）。
 * （原「工厂与公共面同一 seam」一条随 #199 入口清空失效——内联工厂已删，
 *   等价构造直走 `new SpecAcceptanceGate(...)`，配置形状不变）
 *
 * 旧格式 `AcceptanceCriteria` 类型已随 gates 层现代化删除（旧兼容分支同删），
 * 本闸不再钉它的形状。
 */

import * as fs from 'fs';
import * as path from 'path';
import { SpecAcceptanceGate } from '../acceptance';
import type {
  SpecAcceptanceGateConfig,
  AcceptanceGateContext,
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

  it('公共面 AcceptanceGateContext 形状不变', () => {
    const context: AcceptanceGateContext = {
      projectPath: '/tmp/proj',
      taskId: 'TASK-001',
      tasksPath: 'tasks.yml',
    };
    expect(context.projectPath).toBe('/tmp/proj');
  });

  it('宽版配置（含 e2e 字段）可直接构造（与收回前公共面同一形状）', () => {
    const gate = new SpecAcceptanceGate({
      e2eTestCommand: 'npx playwright test',
      e2eTestTimeout: 60000,
      projectPath: '/tmp/proj',
    });
    expect(gate).toBeInstanceOf(SpecAcceptanceGate);
  });

  it('acceptance.ts 不再持有两类型与工厂的双份定义，旧格式 AcceptanceCriteria 已消失', () => {
    const source = fs.readFileSync(path.join(__dirname, '../acceptance.ts'), 'utf-8');
    expect(source).not.toMatch(
      /export interface (SpecAcceptanceGateConfig|AcceptanceGateContext)\b/,
    );
    expect(source).not.toMatch(/export function createSpecAcceptanceGate\b/);
    // 旧格式兼容面（harness gates 现代化）：类型与字段都不再出现
    expect(source).not.toContain('AcceptanceCriteria');
    expect(source).not.toContain('acceptance_criteria');
  });

  it('gates/types.ts 不再持有旧格式 AcceptanceCriteria 与死配置 customAcceptanceCriteria', () => {
    const source = fs.readFileSync(path.join(__dirname, '../types.ts'), 'utf-8');
    expect(source).not.toContain('AcceptanceCriteria');
    expect(source).not.toContain('customAcceptanceCriteria');
  });
});
