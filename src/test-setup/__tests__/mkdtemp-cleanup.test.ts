/**
 * mkdtemp 泄漏防护测试（2026-08-26 /tmp 3.9 万残留事故，与 studio 同款机制）。
 * 正本见 ../mkdtemp-cleanup.ts。
 */
import fs from 'fs';
import path from 'path';
import {
  patchMktempCleanup,
  isRegisteredTmpDir,
  sweepStaleMkdtempDirs,
} from '../mkdtemp-cleanup';

describe('mkdtemp-cleanup', () => {
  it('patch 后 mkdtempSync 创建的目录进注册表（幂等）', () => {
    patchMktempCleanup();
    const d = fs.mkdtempSync(path.join('/tmp', 'harness-mkdtemp-cleanup-test-'));
    expect(fs.existsSync(d)).toBe(true);
    expect(isRegisteredTmpDir(d)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('sweep 只删超过年龄阈值且符合 mkdtemp 签名的目录', () => {
    const base = fs.mkdtempSync(path.join('/tmp', 'harness-mkdtemp-cleanup-sweep-'));
    const cases: Array<{ name: string; ageH: number; shouldRemove: boolean }> = [
      { name: 'fake-test-aB3xY9', ageH: 25, shouldRemove: true }, // 签名匹配 + 超龄 -> 删
      { name: 'fake-test-cD4zW0', ageH: 1, shouldRemove: false }, // 签名匹配但新鲜 -> 留
      { name: 'org.chromium.Chromium.RJ5vUP', ageH: 25, shouldRemove: false }, // 含点（chrome crashpad）-> 不匹配
      { name: 'fake-test-ab12', ageH: 25, shouldRemove: false }, // 后缀 4 字符 -> 不匹配
      { name: 'tsx-0', ageH: 25, shouldRemove: false }, // 后缀 1 字符 -> 不匹配
    ];
    for (const c of cases) {
      const p = path.join(base, c.name);
      fs.mkdirSync(p);
      const t = new Date(Date.now() - c.ageH * 3600 * 1000);
      fs.utimesSync(p, t, t);
    }

    const removed = sweepStaleMkdtempDirs(base, 24 * 3600 * 1000);
    expect(removed).toBe(1);
    for (const c of cases) {
      expect(fs.existsSync(path.join(base, c.name))).toBe(!c.shouldRemove);
    }
    fs.rmSync(base, { recursive: true, force: true });
  });
});
