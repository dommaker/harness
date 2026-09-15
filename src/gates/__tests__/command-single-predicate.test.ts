/**
 * CommandGate 单一匹配谓词闸（#135，架构评审候选 6）
 *
 * 三条逐行同构的匹配循环（`check()` 经 `checkBlacklist()` / `isAllowed()` / `getRiskLevel()`）
 * 收成一个谓词「命令串 → 命中规则集合」，三个入口退化成它之上的投影。本文件钉两件事：
 * ① 源形状闸——匹配语义（模式测试 / 类别忽略）在文件内只有一处落点，grep 可证；
 * ② 一致性闸——同一条目经三个投影得到的裁决互相自洽。
 *
 * ② 用 `addRule()` 挂的合成规则跑，不涉出厂规则表内容（对外措辞纪律 PIT-021）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandGate } from '../command';
import type { CommandBlacklistRule } from '../types';

const source = fs.readFileSync(path.join(__dirname, '..', 'command.ts'), 'utf-8');

/** 数一个针脚在源文件里出现几次（`split` 计数，不做正则解释） */
function count(needle: string): number {
  return source.split(needle).length - 1;
}

/** 合成规则：三条各自只匹配自己的记号，级别覆盖 block/warn/audit 三档 */
const SYN_BLOCK: CommandBlacklistRule = {
  id: 'syn-block',
  pattern: /\bSYN_BLOCK\b/,
  level: 'block',
  message: '合成阻断',
  category: 'syn-a',
};
const SYN_WARN: CommandBlacklistRule = {
  id: 'syn-warn',
  pattern: /\bSYN_WARN\b/,
  level: 'warn',
  message: '合成警告',
  category: 'syn-b',
};
const SYN_AUDIT: CommandBlacklistRule = {
  id: 'syn-audit',
  pattern: /\bSYN_AUDIT\b/,
  level: 'audit',
  message: '合成审计',
  category: 'syn-c',
};
const SYN_IGNORED: CommandBlacklistRule = {
  id: 'syn-ignored',
  pattern: /\bSYN_IGNORED\b/,
  level: 'block',
  message: '合成阻断（类别被忽略）',
  category: 'syn-d',
};

/** 装配一台只认合成规则的门禁：出厂规则整体移除，投影一致性判定的输入面因此可控 */
function syntheticGate(): CommandGate {
  const gate = new CommandGate();
  for (const rule of gate.getBlacklist()) gate.removeRule(rule.id);
  gate.addRule(SYN_WARN);
  gate.addRule(SYN_BLOCK);
  gate.addRule(SYN_AUDIT);
  gate.addRule(SYN_IGNORED);
  return gate;
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
      const gate = syntheticGate();
      const cases: Array<{ command: string; passed: boolean; allowed: boolean; level: string }> = [
        { command: 'SYN_BLOCK', passed: false, allowed: false, level: 'high' },
        { command: 'SYN_WARN', passed: true, allowed: true, level: 'medium' },
        { command: 'SYN_AUDIT', passed: true, allowed: true, level: 'low' },
        { command: 'nothing matches', passed: true, allowed: true, level: 'low' },
      ];

      for (const { command, passed, allowed, level } of cases) {
        const result = await gate.check(command);
        expect(result.passed).toBe(passed);
        expect(gate.isAllowed(command)).toBe(allowed);
        expect(gate.getRiskLevel(command)).toBe(level);
      }
    });

    it('不变式：blocked 级命中 ⟺ check 不通过 ⟺ isAllowed false ⟺ 等级 high', async () => {
      const gate = syntheticGate();
      const corpus = ['SYN_BLOCK', 'SYN_WARN', 'SYN_AUDIT', 'SYN_WARN SYN_AUDIT', 'clean'];

      for (const command of corpus) {
        const result = await gate.check(command);
        const allowed = gate.isAllowed(command);
        const level = gate.getRiskLevel(command);
        const blocked = (result.details?.blocked ?? []).length > 0;

        expect(allowed).toBe(!blocked);
        expect(result.passed).toBe(!blocked);
        expect(level === 'high').toBe(blocked);
      }
    });

    it('等级取命中集合里的最高档，与规则表次序无关（首条命中即返回的旧语义不再存在）', async () => {
      const gate = syntheticGate();
      // 合成装配里 warn 排在 block 之前：只取首条命中会报 medium 而 check/isAllowed 判阻断
      const command = 'SYN_WARN SYN_BLOCK';

      expect(gate.getRiskLevel(command)).toBe('high');
      expect(gate.isAllowed(command)).toBe(false);
      expect((await gate.check(command)).passed).toBe(false);
    });

    it('忽略类别对三投影同样生效（同一谓词，不会一处忽略一处不忽略）', async () => {
      const gate = new CommandGate({ ignoreCategories: ['syn-d'] });
      for (const rule of gate.getBlacklist()) gate.removeRule(rule.id);
      gate.addRule(SYN_IGNORED);

      expect(gate.isAllowed('SYN_IGNORED')).toBe(true);
      expect(gate.getRiskLevel('SYN_IGNORED')).toBe('low');
      expect((await gate.check('SYN_IGNORED')).passed).toBe(true);
    });
  });
});
