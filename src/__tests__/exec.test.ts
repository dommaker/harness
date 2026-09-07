/**
 * exec 工具测试
 */

import { describe, it, expect } from '@jest/globals';
import { runCommand, isCommandAvailable, normalizeTriggers, matchesTrigger, delay } from '../utils/exec';

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

  describe('isCommandAvailable', () => {
    it('存在的命令应该返回 true', async () => {
      const result = await isCommandAvailable('ls');
      expect(result).toBe(true);
    });

    it('不存在的命令应该返回 false', async () => {
      const result = await isCommandAvailable('nonexistent_command_xyz');
      expect(result).toBe(false);
    });

    it('常见命令应该可用', async () => {
      expect(await isCommandAvailable('cat')).toBe(true);
      expect(await isCommandAvailable('grep')).toBe(true);
    });
  });

  describe('normalizeTriggers', () => {
    it('应该返回 fallback 当值为 null', () => {
      const result = normalizeTriggers(null, ['default']);
      expect(result).toEqual(['default']);
    });

    it('应该返回 fallback 当值为 undefined', () => {
      const result = normalizeTriggers(undefined, ['default']);
      expect(result).toEqual(['default']);
    });

    it('应该将单值包装为数组', () => {
      const result = normalizeTriggers('single');
      expect(result).toEqual(['single']);
    });

    it('应该直接返回数组', () => {
      const result = normalizeTriggers(['a', 'b']);
      expect(result).toEqual(['a', 'b']);
    });

    it('应该使用空数组作为默认 fallback', () => {
      const result = normalizeTriggers(undefined);
      expect(result).toEqual([]);
    });
  });

  describe('matchesTrigger', () => {
    it('单值 trigger 命中操作返回 true', () => {
      expect(matchesTrigger({ trigger: 'a' }, ['a'])).toBe(true);
    });

    it('单值 trigger 未命中返回 false', () => {
      expect(matchesTrigger({ trigger: 'a' }, ['b'])).toBe(false);
    });

    it('数组 trigger 任一命中即返回 true', () => {
      expect(matchesTrigger({ trigger: ['a', 'b'] }, ['b'])).toBe(true);
    });

    it('数组 trigger 全部未命中返回 false', () => {
      expect(matchesTrigger({ trigger: ['a', 'b'] }, ['c', 'd'])).toBe(false);
    });

    it('operations 中任一命中即返回 true', () => {
      expect(matchesTrigger({ trigger: 'a' }, ['x', 'a'])).toBe(true);
    });

    it('trigger 为 undefined 时不匹配任何操作', () => {
      expect(matchesTrigger({ trigger: undefined }, ['a'])).toBe(false);
    });

    it('trigger 为空数组时不匹配任何操作', () => {
      expect(matchesTrigger({ trigger: [] }, ['a'])).toBe(false);
    });

    it('operations 为空数组时返回 false', () => {
      expect(matchesTrigger({ trigger: 'a' }, [])).toBe(false);
    });
  });

  describe('delay', () => {
    it('应该延迟指定时间', async () => {
      const start = Date.now();
      await delay(10);
      expect(Date.now() - start).toBeGreaterThanOrEqual(8);
    });
  });
});
