/**
 * exec 工具测试
 *
 * 零消费者与跨 seam 谓词的收缩记录（harness#137 / #162，判据同 ADR-0022）：
 * - `isCommandAvailable` / `delay` 双仓零生产消费者，已删（#137）；
 * - `normalizeTriggers` / `matchesTrigger` 是约束域谓词（harness#105），已迁
 *   `src/core/constraints/triggers.ts`，用例正本见 `core/constraints/__tests__/triggers.test.ts`；
 * - `runCommand` 已删（#162）：#137 头注原记「`core/constraints/check-cache.ts`、`git-evidence.ts`
 *   有生产消费者」，实测两处均为**注释**引用（示例用法与缓冲上限说明），非测试代码里
 *   `runCommand(` 调用点为 0，且它不在包公共面（`src/index.ts` 与 `package.json` 五个
 *   exports 入口均无）——与 `isCommandAvailable`/`delay` 同属「测试为假想消费者站岗」，
 *   按 ADR-0022 同判据删除，外部不可达故零迁移成本。
 * 下列 `@ts-expect-error` 与运行时键断言双向钉住：删多（指令失效即红）与复活（键重新出现即红）。
 */

import { describe, it, expect } from '@jest/globals';
// @ts-expect-error isCommandAvailable 零生产消费者，随 harness#137 删除
import { isCommandAvailable } from '../utils/exec';
// @ts-expect-error delay 零生产消费者，随 harness#137 删除
import { delay } from '../utils/exec';
// @ts-expect-error normalizeTriggers 是约束域谓词，已迁 core/constraints/triggers（harness#137）
import { normalizeTriggers } from '../utils/exec';
// @ts-expect-error matchesTrigger 是约束域谓词，已迁 core/constraints/triggers（harness#137）
import { matchesTrigger } from '../utils/exec';
// @ts-expect-error runCommand 零生产消费者且不在包公共面，随 harness#162 删除（判据见头注）
import { runCommand } from '../utils/exec';

describe('exec utils', () => {
  describe('零消费者与跨 seam 收缩（harness#137 / #162）', () => {
    it('已删/已迁的五个名字在模块运行时键里都不存在', async () => {
      const mod = await import('../utils/exec');
      expect(Object.keys(mod).sort()).toEqual(['execAsync']);
      for (const gone of [
        'isCommandAvailable',
        'delay',
        'normalizeTriggers',
        'matchesTrigger',
        'runCommand',
      ]) {
        expect(mod).not.toHaveProperty(gone);
      }
    });

    it('编译期钉：五个名字不再是 utils/exec 的导出（复活即 TS2578 红）', () => {
      // 上面的 @ts-expect-error 只在名字**不存在**时成立；此处消费导入名让指令进入生效路径
      expect([isCommandAvailable, delay, normalizeTriggers, matchesTrigger, runCommand]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });
  });
});
