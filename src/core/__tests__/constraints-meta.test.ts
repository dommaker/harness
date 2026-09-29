/**
 * 约束集合元数据（库面，harness#198）
 *
 * `harness constraints --json` 背后的元数据函数从 CLI 命令模块搬入 core 并上公共
 * barrel：消费方免起子进程拿 version/hash/counts。
 */

import { getConstraintsMeta } from '../constraints/meta';
import { getAllConstraints } from '../constraints/definitions';

describe('getConstraintsMeta（库面）', () => {
  it('返回 version/hash/counts；counts 与内置定义清单一致', () => {
    const meta = getConstraintsMeta();
    const all = getAllConstraints();

    expect(typeof meta.version).toBe('string');
    expect(meta.version.length).toBeGreaterThan(0);
    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.counts.errors + meta.counts.warnings).toBe(all.length);
    expect(meta.counts.errors).toBe(all.filter(c => c.severity === 'error').length);
  });

  it('hash 内容稳定（同一定义集两次调用同 hash）', () => {
    expect(getConstraintsMeta().hash).toBe(getConstraintsMeta().hash);
  });
});
