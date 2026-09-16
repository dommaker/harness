/**
 * command 门禁的两个死配置位已删除（#135，架构评审候选 6）
 *
 * `CommandGateConfig.strict` 只在构造时读一次、任何判定路径从不使用——`harness command --strict`
 * 与不带它判定完全一致；`CommandGateConfig.customBlacklist` 全仓零生产注入者，运行时扩展点是
 * `addRule()`。triage 裁决两项都**删**（判据同 ADR-0018/0022：不接进判定、不留「配了不生效」），
 * CLI `--strict` 旗帜随之 removal（属 breaking，见 ADR-0024）。
 *
 * 手法照 `passes-gate-dead-options.test.ts` / `init-dead-options.test.ts`：编译期
 * `@ts-expect-error` 钉字段不存在 + 运行期钉定义表旗帜面与配置形状。
 */

import * as fs from 'fs';
import * as path from 'path';
import { GATE_DEFINITIONS } from '../../../gates/definitions';
import { CommandGate } from '../../../gates/command';
import type { CommandGateConfig } from '../../../gates/types';
import type { CommandCheckOptions } from '../command';

const commandGateCli = GATE_DEFINITIONS.find(gate => gate.id === 'command')!.cli;

describe('command 门禁的 strict / customBlacklist 已删除（#135）', () => {
  it('定义表已注册 command 门禁（前提）', () => {
    expect(commandGateCli).toBeDefined();
  });

  it('command 旗帜面逐字冻结，不含 --strict', () => {
    expect(commandGateCli.options.map(option => option.flags)).toEqual([
      '-l, --level',
      '--list',
      '--json',
    ]);
  });

  it('CommandGateConfig 与 CommandCheckOptions 的 strict / customBlacklist 已从类型面消失（编译期钉）', () => {
    // @ts-expect-error strict 零消费者（只在构造时读取），随 #135 从 CommandGateConfig 删除
    const removedStrict: CommandGateConfig = { strict: true };
    // @ts-expect-error customBlacklist 零生产注入者，运行时扩展点是 addRule()，随 #135 删除
    const removedCustom: CommandGateConfig = { customBlacklist: [] };
    // @ts-expect-error CLI 同名字段随 --strict 旗帜与装配一并删除
    const removedOption: CommandCheckOptions = { strict: true };
    expect([removedStrict, removedCustom, removedOption]).toHaveLength(3);
  });

  it('活字段仍可赋值（防止删多）', () => {
    const live: CommandGateConfig = { ignoreCategories: ['database'] };
    const liveCli: CommandCheckOptions = { level: true, list: true, json: false };
    expect(Object.keys(live)).toHaveLength(1);
    expect(Object.keys(liveCli)).toHaveLength(3);
  });

  it('配置读取面只剩 ignoreCategories（运行期形状钉）', () => {
    expect(Object.keys(new CommandGate().getConfig())).toEqual(['ignoreCategories']);
  });

  it('CLI 装配点不再引用模块级单例出口（--level 与默认分支同一实例来源）', () => {
    const cliSource = fs.readFileSync(path.join(__dirname, '..', 'command.ts'), 'utf-8');
    expect(cliSource).not.toMatch(/getCommandRiskLevel|getCommandGate\(/);
  });
});
