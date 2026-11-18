/**
 * 统一命令执行策略（D3，P0.5 Phase 1）测试
 *
 * 三命令（check/validate/report）共用同一授权与跳过语义：
 * - createCommandExecutionPolicy：readOnly 缺省 false = 默认执行（库调用兼容）；
 *   execute 是注入执行缝（read-only 下消费方保证零调用）
 * - skipReason：read-only 跳过原因唯一措辞来源
 * - planCommandsFromConstraints / planCommandsFromCheckpoints：项目 YAML 声明命令的
 *   发现（清单数据源，三命令共享，不各抄一份）
 * - formatCommandPlan：清单渲染（人读行形状钉住）
 */

import { describe, it, expect } from '@jest/globals';
import {
  createCommandExecutionPolicy,
  planCommandsFromConstraints,
  planCommandsFromCheckpoints,
  formatCommandPlan,
} from '../command-execution-policy';
import type { Constraint } from '../../types/constraint';
import type { Checkpoint } from '../../types/checkpoint';

describe('createCommandExecutionPolicy', () => {
  it('缺省 = 默认执行（readOnly false，execute 是真实 spawn 执行）', async () => {
    const policy = createCommandExecutionPolicy();
    expect(policy.readOnly).toBe(false);
    const result = await policy.execute('node -e "process.exit(0)"', process.cwd(), 30_000);
    expect(result.code).toBe(0);
  });

  it('readOnly true：skipReason 统一措辞（含 --read-only 与命令原文）', () => {
    const policy = createCommandExecutionPolicy({ readOnly: true });
    expect(policy.readOnly).toBe(true);
    expect(policy.skipReason('npm test')).toContain('--read-only');
    expect(policy.skipReason('npm test')).toContain('npm test');
    expect(policy.skipReason('npm test')).toContain('未执行');
  });

  it('注入 execute 替身：普通模式下经替身执行（执行缝被消费方使用）', async () => {
    const calls: Array<{ command: string; cwd: string; timeoutMs: number }> = [];
    const policy = createCommandExecutionPolicy({
      execute: async (command, cwd, timeoutMs) => {
        calls.push({ command, cwd, timeoutMs });
        return { code: 0, signal: null, timedOut: false, stdout: '', stderr: '', truncated: false };
      },
    });
    const result = await policy.execute('any-cmd', '/tmp/x', 1234);
    expect(result.code).toBe(0);
    expect(calls).toEqual([{ command: 'any-cmd', cwd: '/tmp/x', timeoutMs: 1234 }]);
  });
});

function constraint(partial: Partial<Constraint> & { id: string }): Constraint {
  return { rule: 'r', message: 'm', severity: 'error', enforcement: '', ...partial };
}

const CTX = { operation: 'file_modification', projectPath: '/x' };

describe('planCommandsFromConstraints（生效约束集 → 声明命令清单）', () => {
  it('checker=exec 且 params.command 非空的 gate 条目进清单', () => {
    const plan = planCommandsFromConstraints({
      app_a: constraint({ id: 'app_a', checker: 'exec', params: { command: 'node x.mjs' } }),
    }, CTX);
    expect(plan).toEqual([{ source: 'app_a', command: 'node x.mjs' }]);
  });

  it('非 gate 通道（workflow/discipline）不执行，不进清单', () => {
    const plan = planCommandsFromConstraints({
      app_w: constraint({ id: 'app_w', channel: 'workflow', checker: 'exec', params: { command: 'node x.mjs' } }),
      app_d: constraint({ id: 'app_d', channel: 'discipline', checker: 'exec', params: { command: 'node y.mjs' } }),
    }, CTX);
    expect(plan).toEqual([]);
  });

  it('无 checker / 缺 command / 空串 command 不进清单', () => {
    const plan = planCommandsFromConstraints({
      builtin_x: constraint({ id: 'builtin_x' }),
      app_no_cmd: constraint({ id: 'app_no_cmd', checker: 'exec', params: {} }),
      app_empty: constraint({ id: 'app_empty', checker: 'exec', params: { command: '' } }),
      other_tpl: constraint({ id: 'other_tpl', checker: 'regex-scan', params: { pattern: 'x' } }),
    }, CTX);
    expect(plan).toEqual([]);
  });

  it('merged.constraints 缺省（旧 mock 形状）不炸，空清单', () => {
    expect(planCommandsFromConstraints(undefined, CTX)).toEqual([]);
  });
});

describe('planCommandsFromConstraints × 触发域过滤（与 checker 分发同口径）', () => {
  const constraints = {
    // 恒评估（未声明 trigger）——任何 operation 都进清单
    app_always: constraint({ id: 'app_always', checker: 'exec', params: { command: 'node always.mjs' } }),
    // trigger = commit：只有 commit 操作进清单
    app_commit: constraint({
      id: 'app_commit',
      checker: 'exec',
      params: { command: 'node commit.mjs' },
      trigger: 'commit',
    }),
    // trigger 数组：任一命中即进（与 matchesTrigger 同口径）
    app_multi: constraint({
      id: 'app_multi',
      checker: 'exec',
      params: { command: 'node multi.mjs' },
      trigger: ['module_creation', 'design_request'],
    }),
  };

  it('trigger 不匹配的 exec 约束不进清单（清单 = 本次将执行/跳过的命令）', () => {
    const plan = planCommandsFromConstraints(constraints, { operation: 'file_modification', projectPath: '/x' });
    expect(plan.map(p => p.source)).toEqual(['app_always']);
  });

  it('operation 命中 trigger 才进清单', () => {
    const plan = planCommandsFromConstraints(constraints, { operation: 'commit', projectPath: '/x' });
    expect(plan.map(p => p.source)).toEqual(['app_always', 'app_commit']);
  });

  it('extraTriggers 命中也算（与 findApplicableConstraints 同一 operations 口径）', () => {
    const plan = planCommandsFromConstraints(constraints, {
      operation: 'file_modification',
      extraTriggers: ['design_request'],
      projectPath: '/x',
    });
    expect(plan.map(p => p.source)).toEqual(['app_always', 'app_multi']);
  });

  it('context 必填（调用点不再可能漏传过滤）', () => {
    // @ts-expect-error 第二参 context 必填
    expect(() => planCommandsFromConstraints(constraints)).toThrow();
  });
});

describe('planCommandsFromCheckpoints（检查点 → 声明命令清单）', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'cp-1',
      checks: [
        { id: 'c1', type: 'command_success', config: { command: 'npm run build' } },
        { id: 'c2', type: 'command_output', config: { command: 'npm run lint', expected: 'clean' } },
        { id: 'c3', type: 'output_contains', config: { content: 'ok', command: 'npm test' } },
        { id: 'c4', type: 'output_not_contains', config: { content: 'err', command: 'npm e2e' } },
        { id: 'c5', type: 'output_matches', config: { pattern: '\\d+', command: 'npm cov' } },
        // 无 command 的 output_* 不执行，不进清单
        { id: 'c6', type: 'output_contains', config: { content: 'ok' } },
        // json_path 当前不执行 command（边界钉死：不进清单、不被 read-only 跳过）
        { id: 'c7', type: 'json_path', config: { jsonPath: 'a.b', command: 'npm never' } },
        // 非命令族不进清单
        { id: 'c8', type: 'file_exists', config: { path: 'x' } },
        { id: 'c9', type: 'http_status', config: { url: 'http://localhost/' } },
      ],
    },
  ];

  it('只收集会执行的声明命令（command_* 必填 + 带 command 的 output_*）', () => {
    const plan = planCommandsFromCheckpoints(checkpoints);
    expect(plan).toEqual([
      { source: 'cp-1/c1', command: 'npm run build' },
      { source: 'cp-1/c2', command: 'npm run lint' },
      { source: 'cp-1/c3', command: 'npm test' },
      { source: 'cp-1/c4', command: 'npm e2e' },
      { source: 'cp-1/c5', command: 'npm cov' },
    ]);
  });

  it('output_* 的空串 command 不进清单', () => {
    const plan = planCommandsFromCheckpoints([
      { id: 'cp', checks: [{ id: 'c', type: 'output_contains', config: { content: 'x', command: '' } }] },
    ]);
    expect(plan).toEqual([]);
  });
});

describe('formatCommandPlan（清单渲染）', () => {
  it('每行一条：命令 + 来源', () => {
    const lines = formatCommandPlan([
      { source: 'app_a', command: 'node x.mjs' },
      { source: 'cp-1/c1', command: 'npm test' },
    ]);
    expect(lines).toEqual(['   - node x.mjs（app_a）', '   - npm test（cp-1/c1）']);
  });

  it('空清单零噪声', () => {
    expect(formatCommandPlan([])).toEqual([]);
  });
});
