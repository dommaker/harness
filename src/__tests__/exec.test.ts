/**
 * exec 工具测试
 *
 * 零消费者与跨 seam 谓词的收缩记录（harness#137，判据同 ADR-0022）：
 * - `isCommandAvailable` / `delay` 双仓零生产消费者，已删；
 * - `normalizeTriggers` / `matchesTrigger` 是约束域谓词（harness#105），已迁
 *   `src/core/constraints/triggers.ts`，用例正本见 `core/constraints/__tests__/triggers.test.ts`；
 * - `runCommand` 保留——`core/constraints/check-cache.ts`、`git-evidence.ts` 有生产消费者。
 * 下列 `@ts-expect-error` 与运行时键断言双向钉住：删多（指令失效即红）与复活（键重新出现即红）。
 */

import { describe, it, expect } from '@jest/globals';
import { runCommand } from '../utils/exec';
// @ts-expect-error isCommandAvailable 零生产消费者，随 harness#137 删除
import { isCommandAvailable } from '../utils/exec';
// @ts-expect-error delay 零生产消费者，随 harness#137 删除
import { delay } from '../utils/exec';
// @ts-expect-error normalizeTriggers 是约束域谓词，已迁 core/constraints/triggers（harness#137）
import { normalizeTriggers } from '../utils/exec';
// @ts-expect-error matchesTrigger 是约束域谓词，已迁 core/constraints/triggers（harness#137）
import { matchesTrigger } from '../utils/exec';

describe('exec utils', () => {
  describe('runCommand', () => {
    it('应该执行命令并返回 stdout', async () => {
      const result = await runCommand('echo hello');
      expect(result).toBe('hello');
    });

    it('不存在的命令应该返回空字符串', async () => {
      const result = await runCommand('nonexistent_command_xyz');
      expect(result).toBe('');
    });

    it('应该支持 cwd 参数', async () => {
      const result = await runCommand('pwd', '/tmp');
      expect(result).toContain('tmp');
    });

    it('多行输出应该保留换行', async () => {
      const result = await runCommand('echo -e "line1\\nline2"');
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });
  });

  describe('零消费者与跨 seam 收缩（harness#137）', () => {
    it('已删/已迁的四个名字在模块运行时键里都不存在', async () => {
      const mod = await import('../utils/exec');
      expect(Object.keys(mod).sort()).toEqual(['execAsync', 'runCommand']);
      for (const gone of ['isCommandAvailable', 'delay', 'normalizeTriggers', 'matchesTrigger']) {
        expect(mod).not.toHaveProperty(gone);
      }
    });

    it('编译期钉：四个名字不再是 utils/exec 的导出（复活即 TS2578 红）', () => {
      // 上面的 @ts-expect-error 只在名字**不存在**时成立；此处消费导入名让指令进入生效路径
      expect([isCommandAvailable, delay, normalizeTriggers, matchesTrigger]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });
  });
});
