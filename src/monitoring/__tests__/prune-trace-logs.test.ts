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

function writeLog(name: string, daysAgo: number): string {
  const file = path.join(logsDir, name);
  fs.writeFileSync(file, '{}\n', 'utf-8');
  const mtime = new Date(Date.now() - daysAgo * DAY_MS);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe('pruneTraceLogs', () => {
  it('删除超龄轮转备份，保留当前文件、新备份与非日志并返回删除数', () => {
    const current = writeLog('traces.log', 400);
    const old = writeLog('traces-2026-07-01T00-00-00-000Z.log', 40);
    const fresh = writeLog('traces-2026-09-20T00-00-00-000Z.log', 5);
    const notLog = writeLog('notes.txt', 400);

    expect(pruneTraceLogs(root)).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(current)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(notLog)).toBe(true);
  });

  it('maxAgeDays 可调整清理阈值', () => {
    writeLog('traces.log', 0);
    const fresh = writeLog('traces-2026-09-25T00-00-00-000Z.log', 5);

    expect(pruneTraceLogs(root, { maxAgeDays: 3 })).toBe(1);
    expect(fs.existsSync(fresh)).toBe(false);
  });

  it('traces 目录不存在时返回 0，且不创建目录', () => {
    fs.rmSync(logsDir, { recursive: true, force: true });

    expect(pruneTraceLogs(root)).toBe(0);
    expect(fs.existsSync(logsDir)).toBe(false);
  });

  it('接受带 projectPath 的运行级观察面', () => {
    writeLog('traces-2026-07-01T00-00-00-000Z.log', 40);

    const envStub = { projectPath: root } as RunEnv;
    expect(pruneTraceLogs(envStub)).toBe(1);
  });
});
