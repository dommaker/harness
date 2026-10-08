/**
 * CommandGate 单一匹配谓词闸（#135，架构评审候选 6）
 *
 * 三条逐行同构的匹配循环（`check()` 经 `checkBlacklist()` / `isAllowed()` / `getRiskLevel()`）
 * 收成一个谓词「命令串 → 命中规则集合」，三个入口退化成它之上的投影。本文件钉两件事：
 * ① 源形状闸——匹配语义（模式测试 / 类别忽略）在文件内只有一处落点，grep 可证；
 * ② 一致性闸——同一条目经三个投影得到的裁决互相自洽。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandGate } from '../command';

const source = fs.readFileSync(path.join(__dirname, '..', 'command.ts'), 'utf-8');

/** 数一个针脚在源文件里出现几次（`split` 计数，不做正则解释） */
function count(needle: string): number {
  return source.split(needle).length - 1;
}

describe('CommandGate 匹配循环唯一化（#135）', () => {
  describe('源形状闸：匹配语义只有一处落点', () => {
    it('规则模式测试恰好一处（此前三条循环各写一遍）', () => {
      expect(count('pattern.test(')).toBe(1);
    });

    it('类别忽略判定恰好一处', () => {
      expect(count('ignoreCategories.includes(')).toBe(1);
    });

    it('遍历规则表的循环体恰好一处，且不再有逐条 switch 分派', () => {
      expect(count('for (const rule of this.blacklist')).toBe(1);
      expect(count('switch (rule.level)')).toBe(0);
    });
  });

  describe('三投影对同一输入互相自洽', () => {
    it('单条命中：check 的裁决 / isAllowed 的布尔 / getRiskLevel 的等级三者一致', async () => {
      const gate = new CommandGate();
      const cases: Array<{ command: string; passed: boolean; allowed: boolean; level: string }> = [
        { command: 'git push --force', passed: false, allowed: false, level: 'high' },
        { command: 'git reset --hard', passed: true, allowed: true, level: 'medium' },
        { command: 'cat ~/.ssh/id_rsa', passed: true, allowed: true, level: 'low' },
        { command: 'ls -la', passed: true, allowed: true, level: 'low' },
      ];

      for (const { command, passed, allowed, level } of cases) {
        const result = await gate.check(command);
        expect(result.passed).toBe(passed);
        expect(gate.isAllowed(command)).toBe(allowed);
        expect(gate.getRiskLevel(command)).toBe(level);
      }
    });

    it('不变式：blocked 级命中 ⟺ check 不通过 ⟺ isAllowed false ⟺ 等级 high', async () => {
      const gate = new CommandGate();
      const corpus = ['git push --force', 'git reset --hard', 'cat ~/.ssh/id_rsa', 'git reset --hard; cat ~/.ssh/id_rsa', 'ls'];

      for (const command of corpus) {
        const result = await gate.check(command);
        const allowed = gate.isAllowed(command);
        const level = gate.getRiskLevel(command);
        const blocked = ((result.details?.blocked ?? []) as unknown[]).length > 0;

        expect(allowed).toBe(!blocked);
        expect(result.passed).toBe(!blocked);
        expect(level === 'high').toBe(blocked);
      }
    });

    it('等级取命中集合里的最高档，与规则表次序无关（首条命中即返回的旧语义不再存在）', async () => {
      const gate = new CommandGate();
      // 'chown root'（warn）在出厂规则表里排在 'sudo rm'（block）之前：
      // 只取首条命中会报 medium 而 check/isAllowed 判阻断
      const command = 'chown root /tmp/x && sudo rm /tmp/y';

      expect(gate.getRiskLevel(command)).toBe('high');
      expect(gate.isAllowed(command)).toBe(false);
      expect((await gate.check(command)).passed).toBe(false);
    });

    it('忽略类别对三投影同样生效（同一谓词，不会一处忽略一处不忽略）', async () => {
      const gate = new CommandGate({ ignoreCategories: ['git'] });

      expect(gate.isAllowed('git push --force')).toBe(true);
      expect(gate.getRiskLevel('git push --force')).toBe('low');
      expect((await gate.check('git push --force')).passed).toBe(true);
    });
  });
});
