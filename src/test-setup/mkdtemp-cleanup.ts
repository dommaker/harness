/**
 * Jest setupFilesAfterEnv - mkdtemp 泄漏防护（2026-08-26 /tmp 3.9 万残留事故根因修复）
 *
 * 事故：5 个测试文件 fs.mkdtempSync 后零清理（constraints-retire / check-drift /
 * constraints-report / agent-prompt-renderer / injection-drift），日常 jest 运行累积。
 *
 * 机制（studio apps/api/tests/mkdtemp-cleanup.ts 同款，jest 版）：
 * 1) patch fs.mkdtempSync--本进程创建的临时目录全部进注册表，afterAll 统一 rmSync。
 *    jest worker 被 kill 时 process 'exit' 不触发，必须用 afterAll（setupFilesAfterEnv
 *    里注册 = 文件级钩子）。
 * 2) import 时清扫 tmpdir 里 >24h 且符合 mkdtemp 签名的目录，兜底 worker 被 kill 的场景。
 *
 * 签名正则只匹配「小写字母数字连字符前缀 + 恰好 6 位大小写字母数字后缀」：
 * chrome crashpad（org.chromium.Chromium.XXXX，含点）、tsx-0 / jest_0 等不匹配。
 */
import fs from 'fs';
import path from 'path';
import { afterAll } from '@jest/globals';

const MKDTEMP_SUFFIX_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-[A-Za-z0-9]{6}$/;

let patched = false;
const registeredDirs = new Set<string>();

/** 幂等。setup 与测试文件重复调用安全。 */
export function patchMktempCleanup(): void {
  if (patched) return;
  patched = true;
  const orig = fs.mkdtempSync as (prefix: string) => string;
  fs.mkdtempSync = ((prefix: string) => {
    const dir = orig(prefix);
    registeredDirs.add(dir);
    return dir;
  }) as typeof fs.mkdtempSync;

  afterAll(() => {
    for (const dir of registeredDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // 清理失败不阻断测试
      }
    }
    registeredDirs.clear();
  });
}

export function isRegisteredTmpDir(dir: string): boolean {
  return registeredDirs.has(dir);
}

/**
 * 清扫 tmpDir 中超龄且符合 mkdtemp 签名的目录。返回删除数。
 * 单条失败（竞态被别进程先删等）不阻断。
 */
export function sweepStaleMkdtempDirs(tmpDir: string, ageMs: number): number {
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpDir);
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    if (!MKDTEMP_SUFFIX_RE.test(name)) continue;
    try {
      const p = path.join(tmpDir, name);
      const st = fs.statSync(p);
      if (st.isDirectory() && now - st.mtimeMs > ageMs) {
        fs.rmSync(p, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // 单条竞态不阻断
    }
  }
  return removed;
}

// setupFilesAfterEnv 顶层执行：打补丁 + 清扫历史残留
patchMktempCleanup();
sweepStaleMkdtempDirs(process.env.TMPDIR || '/tmp', 24 * 60 * 60 * 1000);
