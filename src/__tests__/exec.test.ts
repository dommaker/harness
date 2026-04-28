/**
 * exec 工具测试
 */

import { describe, it, expect } from '@jest/globals';
import { runCommand, isCommandAvailable } from '../utils/exec';

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
});
