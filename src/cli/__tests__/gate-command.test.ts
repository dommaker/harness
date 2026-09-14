/**
 * 门禁命令共享面测试（架构评审候选1）
 *
 * 替身是「假门禁产决策」：不碰 git、不装 gh、不跑真扫描。
 * 断言「六条门禁的失败措辞形状一致」——这份断言在映射散在 6 个 handler 时写不出来。
 */

import {
  gateCommandResult,
  reportGateDecision,
  reportGateError,
  type GateCommandView,
} from '../gate-command';
import { decisionFromResult } from '../../gates/decision';
import { gateResult } from '../../gates/types';
import type { GateDecisionStatus } from '../../gates/types';
import { captureIO, type CapturingIO } from '../command-contract';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

function decide(
  gateId: string,
  passed: boolean,
  message: string,
  details?: Record<string, any>,
  status?: GateDecisionStatus
) {
  return decisionFromResult(gateResult(gateId, passed, message, Date.now(), details), status);
}

function view(over: Partial<GateCommandView> = {}): GateCommandView {
  return { gateId: 'review', label: '代码审查门控', ...over };
}

describe('gateCommandResult — 决策到命令结果的唯一映射', () => {
  it('放行 → ok 且不带 reason', () => {
    expect(gateCommandResult('review', decide('review', true, 'ok'))).toEqual({ kind: 'ok' });
  });

  it('拦下 → fail，reason 为 `<gateId> gate denied: <message>`', () => {
    expect(gateCommandResult('review', decide('review', false, 'needs approval'))).toEqual({
      kind: 'fail',
      reason: 'review gate denied: needs approval',
    });
  });

  it('六条门禁的 denied reason 形状一致', () => {
    for (const id of ['review', 'security', 'performance', 'contract', 'acceptance', 'command']) {
      expect(gateCommandResult(id, decide(id, false, 'boom'))).toEqual({
        kind: 'fail',
        reason: `${id} gate denied: boom`,
      });
    }
  });

  it('ask 无实现者 → fail-closed 按拦下计（与 runGates 聚合同规则）', () => {
    expect(gateCommandResult('review', decide('review', true, 'need human', undefined, 'ask'))).toEqual({
      kind: 'fail',
      reason: 'review gate denied: need human',
    });
  });
});

describe('reportGateDecision — ✓/✗ 输出骨架', () => {
  let io: CapturingIO;

  beforeEach(() => {
    io = captureIO();
  });

  it('通过：空行 + 通过横幅 + onPass 行', () => {
    const result = reportGateDecision(
      io,
      view({ onPass: (r) => [`   审批: ${r.details!.approvals}`] }),
      decide('review', true, 'ok', { approvals: 2 })
    );

    expect(io.outLines()).toEqual(['', '✅ 代码审查门控检查通过', '   审批: 2']);
    expect(result).toEqual({ kind: 'ok' });
  });

  it('未通过：横幅 + message 行 + onFail 行（空串 = 空行）', () => {
    const result = reportGateDecision(
      io,
      view({ onFail: () => ['', 'see the audit'] }),
      decide('review', false, 'needs approval')
    );

    expect(io.outLines()).toEqual([
      '',
      '❌ 代码审查门控检查失败',
      '   needs approval',
      '',
      'see the audit',
    ]);
    expect(result).toEqual({ kind: 'fail', reason: 'review gate denied: needs approval' });
  });

  it('不传闭包时只出空行与横幅（未通过仍出 message 行）', () => {
    reportGateDecision(io, view(), decide('review', true, 'ok'));
    reportGateDecision(io, view(), decide('review', false, 'nope'));

    expect(io.outLines()).toEqual([
      '',
      '✅ 代码审查门控检查通过',
      '',
      '❌ 代码审查门控检查失败',
      '   nope',
    ]);
  });

  it('闭包返回空数组不产生多余行', () => {
    reportGateDecision(io, view({ onPass: () => [] }), decide('review', true, 'ok'));
    expect(io.outLines()).toEqual(['', '✅ 代码审查门控检查通过']);
  });

  it('label 决定横幅用词（验收标准无「门控」二字）', () => {
    reportGateDecision(io, view({ gateId: 'acceptance', label: '验收标准' }), decide('acceptance', true, 'ok'));
    expect(io.outLines()).toEqual(['', '✅ 验收标准检查通过']);
  });
});

describe('reportGateError — 门禁之外的抛出物', () => {
  let io: CapturingIO;

  beforeEach(() => {
    io = captureIO();
  });

  it('出错横幅 + `<gateId> gate error: <message>`', () => {
    const result = reportGateError(io, 'review', '代码审查门控', new Error('boom'));

    expect(io.outLines()).toEqual(['', '❌ 代码审查门控检查出错', '   boom']);
    expect(result).toEqual({ kind: 'fail', reason: 'review gate error: boom' });
  });

  it('extra 按错误文本追加提示行', () => {
    reportGateError(io, 'review', '代码审查门控', new Error('not a git repository'), (msg) =>
      msg.includes('not a git repository') ? ['', '提示: 此命令需要在 Git 仓库中运行'] : []
    );

    expect(io.outLines()).toEqual([
      '',
      '❌ 代码审查门控检查出错',
      '   not a git repository',
      '',
      '提示: 此命令需要在 Git 仓库中运行',
    ]);
  });

  it('非 Error 抛出物按 String() 取原因', () => {
    expect(reportGateError(io, 'contract', '契约门控', 'plain string')).toEqual({
      kind: 'fail',
      reason: 'contract gate error: plain string',
    });
  });
});
