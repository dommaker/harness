/**
 * assertCheckpointShape — checkpoints.yml 形状校验（重构班次 3 Phase 5）
 *
 * CheckConfig 判别联合化后，加载路径按 type 校验 config 必填字段：
 * 缺字段/空串/未知类型即 fail-fast 抛错指名，不再 as 强转蒙混。
 */

import { assertCheckpointShape } from '../checkpoint';

const SRC = 'test.yml';

function cpOf(checks: unknown[]): unknown[] {
  return [{ id: 'cp-1', checks }];
}

describe('assertCheckpointShape', () => {
  it('合法形状全族通过（13 种 type 的必填面）', () => {
    const checks = [
      { id: 'c1', type: 'file_exists', config: { path: 'a.ts' } },
      { id: 'c2', type: 'file_not_empty', config: { path: 'a.ts' } },
      { id: 'c3', type: 'file_contains', config: { path: 'a.ts', content: 'x' } },
      { id: 'c4', type: 'file_not_contains', config: { path: 'a.ts', content: 'x' } },
      { id: 'c5', type: 'command_success', config: { command: 'true' } },
      { id: 'c6', type: 'command_output', config: { command: 'true', expected: 'ok' } },
      { id: 'c7', type: 'output_contains', config: {} },
      { id: 'c8', type: 'output_not_contains', config: {} },
      { id: 'c9', type: 'output_matches', config: { pattern: '^ok$' } },
      { id: 'c10', type: 'json_path', config: { jsonPath: 'a.b' } },
      { id: 'c11', type: 'http_status', config: { url: 'http://x' } },
      { id: 'c12', type: 'http_body', config: { url: 'http://x', expected: 'ok' } },
      { id: 'c13', type: 'custom', config: { customFunction: 'fn' } },
    ];
    expect(() => assertCheckpointShape(cpOf(checks), SRC)).not.toThrow();
  });

  it('缺必填字段 → 抛错指名字段与 type', () => {
    expect(() =>
      assertCheckpointShape(cpOf([{ id: 'c1', type: 'command_success', config: {} }]), SRC)
    ).toThrow(/缺少必填 config 字段: command/);
    expect(() =>
      assertCheckpointShape(cpOf([{ id: 'c2', type: 'http_body', config: { url: 'http://x' } }]), SRC)
    ).toThrow(/缺少必填 config 字段: expected/);
    expect(() =>
      assertCheckpointShape(cpOf([{ id: 'c3', type: 'file_contains', config: { path: 'a' } }]), SRC)
    ).toThrow(/缺少必填 config 字段: content/);
  });

  it('必填字段为空串 → 同缺字段处理', () => {
    expect(() =>
      assertCheckpointShape(cpOf([{ id: 'c1', type: 'file_exists', config: { path: '' } }]), SRC)
    ).toThrow(/缺少必填 config 字段: path/);
  });

  it('未知检查类型 → 抛错点名', () => {
    expect(() =>
      assertCheckpointShape(cpOf([{ id: 'c1', type: 'bogus', config: {} }]), SRC)
    ).toThrow(/未知检查类型: bogus/);
  });

  it('缺 config 对象 / 顶层非数组 / check 缺 id → 抛错', () => {
    expect(() => assertCheckpointShape(cpOf([{ id: 'c1', type: 'file_exists' }]), SRC)).toThrow(/缺 config 对象/);
    expect(() => assertCheckpointShape({ not: 'array' }, SRC)).toThrow(/顶层不是数组/);
    expect(() => assertCheckpointShape(cpOf([{ type: 'file_exists', config: { path: 'a' } }]), SRC)).toThrow(/缺 id 或 type/);
  });
});
