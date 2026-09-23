/**
 * pretool-use-hook 测试（studio#153）
 *
 * 验收口径：block/warn/audit 行为与 studio-agent 生成版脚本一致——
 * block 级 exit 2 阻断，warn/audit 放行，坏输入 fail-open。
 *
 * P1-7（ADR-0031，wayfinder 票08）：命中留痕走 traces 通道——整个套件 chdir 到
 * tmp 目录运行（TraceCollector 缺省按 cwd 解析 projectPath），断言 JSONL 行；
 * 留痕失败不挡拦截主路径。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { decidePreToolUse, runPreToolUseHook, HOOK_MARKER } from '../pretool-use-hook';
import { CommandGate } from '../gates/command';
import { TraceCollector } from '../monitoring/traces';

/** 构造 provider PreToolUse stdin JSON */
function stdinOf(command: string): string {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
}

describe('pretool-use-hook', () => {
  const origCwd = process.cwd();
  let workDir: string;

  beforeEach(() => {
    // 留痕落点 = <cwd>/.harness/logs/traces.log：chdir 到每轮唯一 tmp 目录，
    // 不污染本仓真 traces.log（回收走 mkdtemp-cleanup 劫持）
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pretool-'));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    jest.restoreAllMocks();
  });

  /** 读本轮 tmp 目录下的 trace JSONL 行 */
  function readTraces(): Array<Record<string, unknown>> {
    const file = path.join(workDir, '.harness', 'logs', 'traces.log');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

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

    it('命中明细随判定带出（hits 含 rule id 与 level）', () => {
      const r = decidePreToolUse(stdinOf('rm -rf /'));
      expect(r.hits.map((h) => h.id)).toContain('rm-rf-root');
      expect(r.hits.every((h) => h.level === 'block')).toBe(true);
    });
  });

  describe('runPreToolUseHook', () => {
    let errorSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
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

  describe('命中留痕（P1-7：traces 通道，只记账不加拦截）', () => {
    beforeEach(() => {
      // 阻断时 stderr 是 provider 回填面，与本组断言无关，收下不打到测试输出
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('block 命中写一条 error/fail 汇总 trace（规则 id + 命令首 token 进 evidence，不记完整命令）', () => {
      expect(runPreToolUseHook(stdinOf('rm -rf /'))).toBe(2);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        constraintId: 'command-gate',
        severity: 'error',
        result: 'fail',
        operation: 'pretool-use-hook',
      });
      const evidence = traces[0].evidence as string[];
      expect(evidence).toContain('rule:rm-rf-root');
      expect(evidence).toContain('cmd:rm');
      // 脱敏：完整命令文本（可能含敏感参数）不进 evidence
      expect(evidence.join(' ')).not.toContain('rm -rf /');
    });

    it('warn 命中写 warning/pass trace，仍放行', () => {
      expect(runPreToolUseHook(stdinOf('psql -c "DROP TABLE users"'))).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        constraintId: 'command-gate',
        severity: 'warning',
        result: 'pass',
        operation: 'pretool-use-hook',
      });
      expect(traces[0].evidence).toContain('rule:drop-table');
    });

    it('audit 命中写 info/pass trace，仍放行', () => {
      expect(runPreToolUseHook(stdinOf('cat .env'))).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        constraintId: 'command-gate',
        severity: 'info',
        result: 'pass',
        operation: 'pretool-use-hook',
      });
      expect(traces[0].evidence).toContain('rule:read-env');
    });

    it('干净命令不写 trace', () => {
      expect(runPreToolUseHook(stdinOf('git status'))).toBe(0);
      expect(readTraces()).toHaveLength(0);
    });

    it('留痕失败不影响拦截主路径（fail-open：block 照拦、放行照放）', () => {
      jest.spyOn(TraceCollector.prototype, 'record').mockImplementation(() => {
        throw new Error('disk full');
      });

      expect(runPreToolUseHook(stdinOf('rm -rf /'))).toBe(2);
      expect(runPreToolUseHook(stdinOf('killall node'))).toBe(0);
    });
  });

  describe('非 Bash 工具事件（P1-5：只留痕不拦截，拦截归 codex 沙箱）', () => {
    it('Edit 事件放行（exit 0）并写 tool-event trace（evidence 记工具名 + file_path，不记内容正文）', () => {
      const stdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/a.ts', old_string: 'SECRET=abc123', new_string: 'SECRET=def456' },
      });
      expect(runPreToolUseHook(stdin)).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        constraintId: 'tool-event:Edit',
        severity: 'info',
        result: 'pass',
        operation: 'pretool-use-hook',
      });
      expect(traces[0].evidence).toEqual(['tool:Edit', 'path:src/a.ts']);
      // 内容正文（可能含敏感值）不进 trace
      expect(JSON.stringify(traces[0])).not.toContain('abc123');
    });

    it('Write 事件放行并留痕', () => {
      const stdin = JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'docs/note.md', content: 'body' },
      });
      expect(runPreToolUseHook(stdin)).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].constraintId).toBe('tool-event:Write');
      expect(traces[0].evidence).toEqual(['tool:Write', 'path:docs/note.md']);
    });

    it('apply_patch 事件（无 file_path）放行并留痕，evidence 只记工具名', () => {
      const stdin = JSON.stringify({
        tool_name: 'apply_patch',
        tool_input: { patch: '*** Begin Patch' },
      });
      expect(runPreToolUseHook(stdin)).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].constraintId).toBe('tool-event:apply_patch');
      expect(traces[0].evidence).toEqual(['tool:apply_patch']);
    });

    it('MCP 工具事件放行并留痕', () => {
      const stdin = JSON.stringify({
        tool_name: 'mcp__local-rag__query_documents',
        tool_input: { query: 'x' },
      });
      expect(runPreToolUseHook(stdin)).toBe(0);

      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].constraintId).toBe('tool-event:mcp__local-rag__query_documents');
    });

    it('非 Bash 事件即使 tool_input 带危险 command 字段也不拦（判定面只认 Bash）', () => {
      const stdin = JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'a.ts', command: 'rm -rf /' },
      });
      const r = decidePreToolUse(stdin);
      expect(r.allowed).toBe(true);
      expect(r.toolName).toBe('Edit');
      expect(runPreToolUseHook(stdin)).toBe(0);
    });

    it('Bash 事件判定维持不变（回归：block 仍 exit 2）', () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(runPreToolUseHook(stdinOf('rm -rf /'))).toBe(2);
      const traces = readTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].constraintId).toBe('command-gate');
    });

    it('缺 tool_name 的旧事件形状按 Bash 兼容（command 照常判定）', () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(runPreToolUseHook(JSON.stringify({ tool_input: { command: 'rm -rf /' } }))).toBe(2);
    });
  });

  describe('CommandGate.match 公共只读面（P1-7）', () => {
    it('返回命中规则明细（id/level/message），与 isAllowed 同一谓词', () => {
      const gate = new CommandGate();
      const hits = gate.match('rm -rf /');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((r) => r.id === 'rm-rf-root' && r.level === 'block')).toBe(true);
      expect(gate.isAllowed('rm -rf /')).toBe(false);
    });

    it('干净命令命中为空', () => {
      expect(new CommandGate().match('git status')).toEqual([]);
    });

    it('类别忽略对 match 同样生效', () => {
      const gate = new CommandGate({ ignoreCategories: ['system'] });
      expect(gate.match('rm -rf /')).toEqual([]);
    });
  });
});
