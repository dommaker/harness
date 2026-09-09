/**
 * passes-gate 重试选项死旗帜闸（code-review A1）
 *
 * 重试实现原住 `setPasses`，随 ADR-0022 删除后 `PassesGateConfig.maxRetries` /
 * `retryDelay` 整条装配链只剩写入方、全仓无读取方——`harness passes-gate
 * --max-retries N` 是恒不生效选项。ADR-0018 删 performance 幽灵旗帜的判据
 * （只执法有真实现的维度）据此收口。
 *
 * 手法同 #125 的 AC-007：编译期 `@ts-expect-error` 钉字段不存在 + 运行期钉定义表与源形状。
 * `src/agents/types.ts` 的 `maxRetries` 是 AgentLifecycle 自有字段（`lifecycle.ts` 真读取），
 * 不在本闸范围内。
 */

import * as fs from 'fs';
import * as path from 'path';
import { COMMAND_DEFINITIONS } from '../definitions';
import type { PassesGateConfig } from '../../../types/passes-gate';
import type { PassesGateOptions } from '../passes-gate';

const passesGateCommand = COMMAND_DEFINITIONS.find(d => d.command === 'passes-gate');
const cliSource = fs.readFileSync(path.join(__dirname, '..', 'passes-gate.ts'), 'utf-8');
const validatorSource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'core', 'validators', 'passes-gate.ts'),
  'utf-8',
);

describe('passes-gate 重试选项已删除（A1）', () => {
  it('定义表已注册 passes-gate（前提）', () => {
    expect(passesGateCommand).toBeDefined();
  });

  it('passes-gate 旗帜面逐字冻结，不含 --max-retries', () => {
    expect((passesGateCommand?.options || []).map(o => o.flags)).toEqual([
      '-t, --test-command <command>',
      '-p, --project-path <path>',
      '--allow-partial',
      '--coverage',
      '--coverage-threshold <n>',
    ]);
  });

  it('命令定义表任意层级都不含 retry 旗帜（防换个命令位复活）', () => {
    expect(JSON.stringify(COMMAND_DEFINITIONS)).not.toMatch(/retry/i);
  });

  it('CLI 装配链与 validator 默认配置都不再写重试字段', () => {
    expect(cliSource).not.toMatch(/maxRetries|retryDelay/);
    expect(validatorSource).not.toMatch(/maxRetries|retryDelay/);
  });

  it('PassesGateConfig / PassesGateOptions 的重试字段已从类型面消失（编译期钉）', () => {
    // @ts-expect-error maxRetries 只写不读，随 A1 从 PassesGateConfig 删除
    const removedMaxRetries: PassesGateConfig = { maxRetries: 2 };
    // @ts-expect-error retryDelay 只写不读，随 A1 从 PassesGateConfig 删除
    const removedRetryDelay: PassesGateConfig = { retryDelay: 1000 };
    // @ts-expect-error CLI 侧同名字段随旗帜与装配一并删除
    const removedOption: PassesGateOptions = { maxRetries: 2 };
    expect([removedMaxRetries, removedRetryDelay, removedOption]).toHaveLength(3);
  });

  it('活字段仍可赋值（防止删多）', () => {
    const live: PassesGateConfig = {
      enabled: true,
      testCommand: 'npm test',
      requireEvidence: false,
      allowPartialPass: true,
    };
    expect(Object.keys(live)).toHaveLength(4);
  });
});
