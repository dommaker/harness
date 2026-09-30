/**
 * pruneTraceLogs（harness#198）
 *
 * traces 轮转备份（traces-*.log）清理的独立库入口：TraceCollector.cleanupOldFiles
 * 的薄包装，消费方不需要理解 traces 目录布局（不再手删 `.harness/logs/` 文件）。
 * 不构造 TraceCollector——缺目录/缺文件一律 no-op 返回 0，零副作用。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pruneTraceLogs } from '../traces';
import type { RunEnv } from '../../core/constraints/run-env';

const DAY_MS = 24 * 3600 * 1000;

let root: string;
let logsDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prune-'));
  logsDir = path.join(root, '.harness', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 造一个带指定 mtime（距今 daysAgo 天）的日志文件 */
function writeLog(name: string, daysAgo: number): string {
  const file = path.join(logsDir, name);
  fs.writeFileSync(file, '{}\n', 'utf-8');
  const mtime = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe('pruneTraceLogs', () => {
  it('删除超龄轮转备份，保留当前 traces.log 与新备份，返回删除数（默认 30 天）', () => {
    const current = writeLog('traces.log', 400); // 当前文件再老也不删
    const old = writeLog('traces-2026-07-01T00-00-00-000Z.log', 40);
    const fresh = writeLog('traces-2026-09-20T00-00-00-000Z.log', 5);
    const notLog = writeLog('notes.txt', 400); // 非 .log 不动

    const deleted = pruneTraceLogs(root);

    expect(deleted).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(current)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(notLog)).toBe(true);
  });

  it('maxAgeDays 可调：阈值收紧则新备份也删', () => {
    writeLog('traces.log', 0);
    const fresh = writeLog('traces-2026-09-25T00-00-00-000Z.log', 5);

    expect(pruneTraceLogs(root, { maxAgeDays: 3 })).toBe(1);
    expect(fs.existsSync(fresh)).toBe(false);
  });

  it('traces 目录不存在 → 0，且不创建目录（零副作用）', () => {
    fs.rmSync(logsDir, { recursive: true, force: true });

    expect(pruneTraceLogs(root)).toBe(0);
    expect(fs.existsSync(logsDir)).toBe(false);
  });

  it('接受运行级观察面（RunTarget 两形同构；分层闸禁止 monitoring 测试值导入 core，用结构桩）', () => {
    writeLog('traces-2026-07-01T00-00-00-000Z.log', 40);

    const envStub = { projectPath: root } as RunEnv;
    expect(pruneTraceLogs(envStub)).toBe(1);
  });
});
