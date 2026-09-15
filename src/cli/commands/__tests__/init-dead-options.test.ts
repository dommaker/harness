/**
 * init 死选项 `-t/--type` 已删除（harness#132 grilling 落定）
 *
 * `-t, --type <type>` 自始只有定义表一条与 `InitOptions.type` 一个字段，全仓无读取方——
 * `harness init -t nextjs-app` 恒不生效。scaffold 收口时按 ADR-0018 判据（只执法有真实现的
 * 维度）连旗帜与字段一并删除。手法同 passes-gate-dead-options.test.ts：编译期
 * `@ts-expect-error` 钉字段不存在 + 运行期钉定义表旗帜面。
 */

import { COMMAND_DEFINITIONS } from '../definitions';
import type { InitOptions } from '../init';

const initCommand = COMMAND_DEFINITIONS.find(d => d.command === 'init');

describe('init 的 -t/--type 已删除（#132）', () => {
  it('定义表已注册 init（前提）', () => {
    expect(initCommand).toBeDefined();
  });

  it('init 旗帜面逐字冻结，不含 --type', () => {
    expect((initCommand?.options || []).map(o => o.flags)).toEqual([
      '-p, --preset <preset>',
      '-g, --governance <level>',
      '--project-path <path>',
      '--no-git-hooks',
      '--no-github-actions',
      '--print-snippets',
    ]);
  });

  it('InitOptions 的 type 字段已从类型面消失（编译期钉）', () => {
    // @ts-expect-error -t/--type 无实现，随 #132 从 InitOptions 删除
    const removed: InitOptions = { preset: 'standard', type: 'nextjs-app' };
    expect(removed).toBeDefined();
  });

  it('活旗帜仍可赋值（防止删多）', () => {
    const live: InitOptions = {
      preset: 'strict',
      governance: 'minimal',
      projectPath: '/tmp/p',
      gitHooks: false,
      githubActions: false,
      printSnippets: true,
    };
    expect(Object.keys(live)).toHaveLength(6);
  });
});
