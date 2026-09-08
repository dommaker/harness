/**
 * FailureRecorder 坏行容错测试（harness#96）
 *
 * fixtures 走真实临时文件（mkdtempSync，统一清理见 src/test-setup）：
 * failures.log 夹一行坏 JSON 时，failure list|stats 不崩栈、
 * stdout（含 --json）逐字节不变、stderr 出现一次含坏行条数的警告。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../cli/command-contract';
import * as os from 'os';
import * as path from 'path';
import { FailureRecorder } from '../recorder';
import { failureList, failureStats } from '../../cli/commands/failure';
import { ErrorType, FailureLevel, DEFAULT_FAILURE_LOG_FILE } from '../../types/failure';

const CORRUPT_LINE = '{"type":"TEST_FAILED","level":"L1","mess'; // 半写入截断

function makeRecorder(logFile: string): FailureRecorder {
  return new FailureRecorder({ logFile });
}

function writeLogFile(dir: string, lines: string[]): string {
  // CLI 侧经 getRecorder 读 <projectPath>/<DEFAULT_FAILURE_LOG_FILE>，fixture 必须落在同一真实路径
  const logFile = path.join(dir, DEFAULT_FAILURE_LOG_FILE);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, lines.join('\n') + '\n', 'utf-8');
  return logFile;
}

function validRecord(message: string): string {
  return JSON.stringify({
    type: ErrorType.TEST_FAILED,
    level: FailureLevel.L1,
    message,
    timestamp: 1700000000000,
  });
}

function captureConsole(): { stdout: string[]; stderr: string[] } {
  const captured = { stdout: [] as string[], stderr: [] as string[] };
  jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    captured.stdout.push(args.map(String).join(' '));
  });
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    captured.stderr.push(args.map(String).join(' '));
  });
  return captured;
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('FailureRecorder 坏行容错（harness#96）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-recorder-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('getHistory()', () => {
    it('坏行不抛：返回全部合法记录', async () => {
      const logFile = writeLogFile(dir, [validRecord('a'), CORRUPT_LINE, validRecord('b')]);
      const records = await makeRecorder(logFile).getHistory();
      expect(records.map(r => r.message)).toEqual(['a', 'b']);
    });

    it('跳过坏行时 stderr 出现一次含条数的警告', async () => {
      const logFile = writeLogFile(dir, [
        validRecord('a'),
        CORRUPT_LINE,
        CORRUPT_LINE,
        validRecord('b'),
      ]);
      const captured = captureConsole();
      await makeRecorder(logFile).getHistory();
      expect(captured.stderr).toHaveLength(1);
      expect(captured.stderr[0]).toContain('2');
      expect(captured.stdout).toEqual([]);
    });

    it('文件不存在落到空态，无警告', async () => {
      const captured = captureConsole();
      const records = await makeRecorder(path.join(dir, 'missing.log')).getHistory();
      expect(records).toEqual([]);
      expect(captured.stderr).toEqual([]);
    });

    it('全部行损坏落到空态', async () => {
      const logFile = writeLogFile(dir, [CORRUPT_LINE, 'not-json']);
      const captured = captureConsole();
      const records = await makeRecorder(logFile).getHistory();
      expect(records).toEqual([]);
      expect(captured.stderr).toHaveLength(1);
    });

    it('limit 只取最近 N 条合法记录', async () => {
      const logFile = writeLogFile(dir, [validRecord('a'), CORRUPT_LINE, validRecord('b'), validRecord('c')]);
      const records = await makeRecorder(logFile).getHistory(2);
      expect(records.map(r => r.message)).toEqual(['b', 'c']);
    });
  });

  describe('getStats()', () => {
    it('统计口径只计合法记录', async () => {
      const logFile = writeLogFile(dir, [validRecord('a'), CORRUPT_LINE, validRecord('b')]);
      const stats = await makeRecorder(logFile).getStats();
      expect(stats.total).toBe(2);
    });
  });

  describe('failure list 命令', () => {
    it('坏行不崩、stdout 与无坏行时逐字节一致、stderr 警告一次', async () => {
      writeLogFile(path.join(dir, 'clean'), [validRecord('a'), validRecord('b')]);
      writeLogFile(path.join(dir, 'dirty'), [validRecord('a'), CORRUPT_LINE, validRecord('b')]);

      // 列表正文走注入 io；损坏行警告由 recorder 自身 console.error 打印
      const cleanIo = captureIO();
      await failureList({ projectPath: path.join(dir, 'clean') }, cleanIo);

      const dirtyCapture = captureConsole();
      const dirtyIo = captureIO();
      const dirtyResult = await failureList({ projectPath: path.join(dir, 'dirty') }, dirtyIo);
      expect(dirtyResult).toEqual({ kind: 'ok' });

      expect(dirtyIo.outText()).toBe(cleanIo.outText());
      expect(dirtyIo.outText()).not.toBe('');
      expect(dirtyCapture.stderr).toHaveLength(1);
      expect(dirtyCapture.stderr[0]).toContain('1');
    });

    it('--json 输出不受 stderr 警告污染且不含坏行', async () => {
      writeLogFile(dir, [validRecord('a'), CORRUPT_LINE]);
      const captured = captureConsole();
      await failureList({ projectPath: dir, json: true }, io);

      expect(captured.stderr).toHaveLength(1);
      const parsed = JSON.parse(io.outText());
      expect(parsed.total).toBe(1);
      expect(parsed.records[0].message).toBe('a');
    });
  });

  describe('failure stats 命令', () => {
    it('坏行不崩、stdout 与无坏行时逐字节一致', async () => {
      writeLogFile(path.join(dir, 'clean'), [validRecord('a'), validRecord('b')]);
      writeLogFile(path.join(dir, 'dirty'), [CORRUPT_LINE, validRecord('a'), validRecord('b')]);

      const cleanIo = captureIO();
      await failureStats({ projectPath: path.join(dir, 'clean') }, cleanIo);

      const dirtyCapture = captureConsole();
      const dirtyIo = captureIO();
      await failureStats({ projectPath: path.join(dir, 'dirty') }, dirtyIo);

      expect(dirtyIo.outText()).toBe(cleanIo.outText());
      expect(dirtyIo.outText()).not.toBe('');
      expect(dirtyCapture.stderr).toHaveLength(1);
    });
  });
});
