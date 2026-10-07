/**
 * 检查器原语 SDK 公共面（harness#181 第二半）
 *
 * 导出纪律 = 只导出存量：CheckOutcome / buildCheckEnv / normalizeCheckOutcome +
 * 现有 checker 真实在用的辅助件（formatEvidence 与接缝类型）。本套件从包根
 * import 原语组装一个「事实 ↔ 期望」式业务 checker，验证导出真实可用；
 * 三处 barrel 清单与三道冻结钉见 public-exports /
 * public-value-surface / public-type-surface。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildCheckEnv,
  formatEvidence,
  normalizeCheckOutcome,
  type CheckOutcome,
  type ConstraintCheck,
} from '../index';
import {
  buildCheckEnv as buildCheckEnvFromCore,
  normalizeCheckOutcome as normalizeFromCore,
} from '../core';
import { createProjectFixture } from '../test-setup/project-fixture';

describe('检查器原语 SDK（harness#181）', () => {
  it('包根与 ./core 子路径同源导出', () => {
    expect(buildCheckEnvFromCore).toBe(buildCheckEnv);
    expect(normalizeFromCore).toBe(normalizeCheckOutcome);
  });

  it('原语组装业务 checker：事实 ↔ 期望的几行绑定', async () => {
    const root = createProjectFixture({
      name: 'sdk-compose',
      files: { 'docs/a.md': 'x' },
    });
    // 事实 = 项目根下文件存在性；期望 = 必需文件都在（业务知识留在业务侧绑定里）
    const check: ConstraintCheck = {
      id: 'app_demo',
      evaluate: (env): CheckOutcome => {
        const missing = ['docs/a.md', 'docs/b.md']
          .filter((f) => !fs.existsSync(path.join(env.projectPath, f)));
        return missing.length > 0
          ? { pass: false, evidence: formatEvidence('必需文件不存在', missing) }
          : true;
      },
    };
    const env = buildCheckEnv({ operation: 'commit', projectPath: root }, 'none');
    const outcome = normalizeCheckOutcome(await check.evaluate(env));
    expect(outcome.satisfied).toBe(false);
    expect(outcome.evidence.join('\n')).toContain('docs/b.md');
    expect(outcome.evidence.join('\n')).not.toContain('docs/a.md');
  });
});
