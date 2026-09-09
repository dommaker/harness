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
import { COMMAND_DEFINITIONS, type CommandDefinition } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';
import type { PassesGateConfig } from '../../../types/passes-gate';
import type { PassesGateOptions } from '../passes-gate';

/**
 * 已删旗帜的精确令牌（二次复审 S2 收口）
 *
 * `--max-retries` 的旗帜名 + 它在 commander 里的选项键名（`optionRoutes.flag` 按键路由，
 * 是同一个已删选项的第二个落点）。**只钉这两个令牌**，不钉「retry 这个词」。
 */
const DELETED_FLAG_TOKENS = ['--max-retries', 'maxRetries'];

interface FlagSite {
  /** 命令位（含父命令前缀，如 'constraints report'） */
  slot: string;
  /** 旗帜令牌（'-t' / '--test-command'）或选项路由键（'list'） */
  token: string;
}

/** 递归收集命令位上的旗帜令牌与选项路由键（走法同 registry.test.ts 的 collectRefs） */
function collectFlagSites(defs: CommandDefinition[], prefix = ''): FlagSite[] {
  return defs.flatMap((def) => {
    const slot = [prefix, def.command].filter(Boolean).join(' ');
    const own: FlagSite[] = [
      ...def.options.flatMap((option) =>
        option.flags
          .split(/[\s,]+/)
          .filter((token) => token.startsWith('-'))
          .map((token) => ({ slot, token })),
      ),
      ...(def.optionRoutes || []).map((route) => ({ slot, token: route.flag })),
    ];
    return [...own, ...collectFlagSites(def.children || [], slot)];
  });
}

function sitesHoldingDeletedFlag(sites: FlagSite[]): FlagSite[] {
  return sites.filter((site) => DELETED_FLAG_TOKENS.includes(site.token));
}

/** 全部命令位：通用命令表 + 门禁命令表（GATE_DEFINITIONS.cli 由 bin 同一引擎生成命令块） */
const ALL_CLI_SITES = [
  ...collectFlagSites(COMMAND_DEFINITIONS),
  ...collectFlagSites(GATE_DEFINITIONS.map((gate) => gate.cli)),
];

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

  it('采集面确实覆盖三类命令位（前提，防空扫致闸失效）', () => {
    const rendered = ALL_CLI_SITES.map(s => `${s.slot} ${s.token}`);
    expect(rendered).toContain('passes-gate --coverage-threshold'); // 通用表叶子命令的旗帜
    expect(rendered).toContain('constraints report --json'); // children 递归（嵌套命令位）
    expect(rendered).toContain('acceptance --task-id'); // 门禁表命令位（GATE_DEFINITIONS.cli）
    expect(rendered).toContain('check list'); // 选项路由键（commander camelCase 键位）
  });

  it('已删的 --max-retries 不在任何命令位复活（逐命令逐选项精确冻结）', () => {
    expect(sitesHoldingDeletedFlag(ALL_CLI_SITES)).toEqual([]);
  });

  /**
   * 旧闸（A5 引入的全表禁词版）——原样保留，与上面的精确冻结并存。
   * 它宽于「冻结已删选项」这一意图：将来任何命令新增合法的 retries 类选项都会被拦。
   * 收窄（即删掉这条）是二次复审 S2 的应修项，但删除断言属 `no_test_simplification`
   * 铁律拦截范围、而该闸无批准通道，故本轮只加不改，退役动作交人类裁决。
   */
  it('命令定义表任意层级都不含 retry 旗帜（防换个命令位复活）', () => {
    expect(JSON.stringify(COMMAND_DEFINITIONS)).not.toMatch(/retry/i);
  });

  /**
   * 反向验闸（二次复审 S2）：把已删旗帜分别挂到「另一条通用命令 / 门禁命令 / 选项路由键」
   * 三处，断言扫描逐字报出——证明换掉的不是空洞，也证明覆盖面真的等于名义上的「任何命令位」。
   * 将来若要在别的命令位做**有真实现**的重试，那是新设计：显式评审后把令牌从
   * DELETED_FLAG_TOKENS 解除（同 ADR-0022 推翻 AC-007 的做法），不靠闸静默放行。
   */
  it('闸非空洞：复活在别的命令位仍会红（通用命令 / 门禁命令 / 选项路由键）', () => {
    const probe = { flags: '--max-retries <n>', description: '复活探针' };
    const otherCommand = COMMAND_DEFINITIONS.find(d => d.command === 'check')!;
    const gateSlot = GATE_DEFINITIONS.find(g => g.id === 'acceptance')!;

    const resurrected = [
      ...collectFlagSites([{ ...otherCommand, options: [...otherCommand.options, probe] }]),
      ...collectFlagSites([{ ...gateSlot.cli, options: [...gateSlot.cli.options, probe] }]),
      ...collectFlagSites([{
        ...otherCommand,
        optionRoutes: [...(otherCommand.optionRoutes || []), { ...otherCommand.optionRoutes![0], flag: 'maxRetries' }],
      }]),
    ];

    expect(sitesHoldingDeletedFlag(resurrected).map(s => `${s.slot} ${s.token}`)).toEqual([
      'check --max-retries',
      'acceptance --max-retries',
      'check maxRetries',
    ]);
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
