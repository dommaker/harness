/**
 * 已退役约束清单（listRetiredConstraints，harness#188）测试
 *
 * 口径：只认 retired 墓碑（enabled:false + retired 段，ADR-0032 决策 6.6），
 * 裸 enabled:false 是"禁用"不是"退休"，不入选。
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import { listRetiredConstraints } from '../core/retired-constraints';
import { createProjectFixture } from '../test-setup/project-fixture';

describe('listRetiredConstraints', () => {
  let tempDir: string;
  let counter = 0;

  const setupProject = (configYaml?: string): string =>
    createProjectFixture({
      parentDir: tempDir,
      name: `p${counter++}`,
      config: configYaml,
    });

  beforeEach(() => {
    tempDir = createProjectFixture({ name: 'temp-test-retired', parentDir: process.cwd() });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('无配置项目：空清单', () => {
    const dir = setupProject();
    expect(listRetiredConstraints(dir)).toEqual([]);
  });

  it('retired 墓碑条目入选，透出 id/enabled/retired 元数据', () => {
    const dir = setupProject(`
constraints:
  capability_sync:
    enabled: false
    retired:
      at: '2026-09-01T00:00:00.000Z'
      reason: 零拦截期满转退役
      stats: { total: 10, fail: 0, failRate: 0 }
`);
    const entries = listRetiredConstraints(dir);

    expect(entries).toEqual([
      {
        id: 'capability_sync',
        enabled: false,
        retired: {
          at: '2026-09-01T00:00:00.000Z',
          reason: '零拦截期满转退役',
          stats: { total: 10, fail: 0, failRate: 0 },
        },
      },
    ]);
  });

  it('裸 enabled:false（禁用非退休）与启用条目都不入选', () => {
    const dir = setupProject(`
constraints:
  docs_freshness:
    enabled: false
  no_hardcoded_credentials:
    enabled: true
  capability_sync:
    enabled: false
    retired:
      at: '2026-09-01T00:00:00.000Z'
      reason: ''
`);
    const entries = listRetiredConstraints(dir);

    expect(entries.map(e => e.id)).toEqual(['capability_sync']);
  });

  it('多条墓碑按 config.yml 条目顺序返回', () => {
    const dir = setupProject(`
constraints:
  docs_freshness:
    enabled: false
    retired: { at: '2026-09-02T00:00:00.000Z', reason: r2 }
  capability_sync:
    enabled: false
    retired: { at: '2026-09-01T00:00:00.000Z', reason: r1 }
`);
    const entries = listRetiredConstraints(dir);

    expect(entries.map(e => e.id)).toEqual(['docs_freshness', 'capability_sync']);
  });

  it('从包根导出（ADR-0003 公共面）', async () => {
    const harness = await import('../index');
    expect(typeof (harness as Record<string, unknown>).listRetiredConstraints).toBe('function');
  });
});
