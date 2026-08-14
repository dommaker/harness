/**
 * analyze-sessions 命令测试（O6）
 *
 * Seam：analyzeSessions(options) 公开入口。
 * 隔离面：
 *   - os.homedir → 测试临时目录（memory 规则库落 TEST_HOME）
 *   - readTranscriptSessions → fixture 会话（extractCorrectionMatches/tokenize 等纯函数保持真实）
 *   - CLAUDE_TRANSCRIPTS_DIR → 测试临时目录（决定 transcripts 目录是否存在）
 */

import * as fs from 'fs';
import * as path from 'path';
import { analyzeSessions } from '../analyze-sessions';
import { readTranscriptSessions, type MinedSession } from '../../session-mining';

const TEST_HOME = '/tmp/harness-analyze-test-home';

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => '/tmp/harness-analyze-test-home',
}));

jest.mock('../../session-mining', () => ({
  ...jest.requireActual('../../session-mining'),
  readTranscriptSessions: jest.fn(),
}));

jest.mock('chalk', () => {
  const id = (s: string) => s;
  const chalkFn = Object.assign(id, {
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  });
  return {
    __esModule: true,
    default: chalkFn,
    gray: id,
    blue: id,
    green: id,
    yellow: id,
    cyan: id,
    bold: id,
    red: id,
  };
});

const mockReadTranscriptSessions = readTranscriptSessions as jest.MockedFunction<
  typeof readTranscriptSessions
>;

const TRANSCRIPTS_DIR = path.join(TEST_HOME, 'transcripts');

function mkSession(partial: Partial<MinedSession> = {}): MinedSession {
  return {
    id: 'session-1',
    date: '2026-08-15',
    mtimeMs: Date.now(),
    turns: [
      { role: 'user', content: '我不是说要用中文吗' },
      { role: 'assistant', content: '收到，改用中文' },
    ],
    toolCalls: [],
    ...partial,
  };
}

function lastJsonOutput(consoleSpy: jest.SpyInstance): Record<string, unknown> {
  const jsonLine = consoleSpy.mock.calls.map(c => c[0]).join('\n');
  return JSON.parse(jsonLine);
}

describe('analyze-sessions command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_HOME, '.claude', 'projects', '-root-projects', 'memory'), { recursive: true });
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    process.env.CLAUDE_TRANSCRIPTS_DIR = TRANSCRIPTS_DIR;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.CLAUDE_TRANSCRIPTS_DIR;
  });

  test('transcripts 目录不存在：提示 No transcripts directory found', async () => {
    process.env.CLAUDE_TRANSCRIPTS_DIR = path.join(TEST_HOME, 'missing-dir');

    await analyzeSessions({});

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No transcripts directory found'));
    expect(mockReadTranscriptSessions).not.toHaveBeenCalled();
  });

  test('窗口内无会话：提示 No sessions found（默认最近 7 天）', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'old', mtimeMs: Date.now() - 30 * 86_400_000 }),
    ]);

    await analyzeSessions({});

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No sessions found in the last 7 days'));
  });

  test('--days 1：只统计最近 1 天（mtimeMs 窗口过滤）', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'today' }),
      mkSession({ id: 'two-days-ago', mtimeMs: Date.now() - 2 * 86_400_000 }),
    ]);

    await analyzeSessions({ days: 1 });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Analyzing 1 sessions (last 1 days)'));
  });

  test('缺省 --days：窗口为 7 天，两天前会话仍计入', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'today' }),
      mkSession({ id: 'two-days-ago', mtimeMs: Date.now() - 2 * 86_400_000 }),
    ]);

    await analyzeSessions({});

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Analyzing 2 sessions (last 7 days)'));
  });

  test('--json：纠正句跨 3 会话聚合为 correction 候选', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 's1' }),
      mkSession({ id: 's2' }),
      mkSession({ id: 's3' }),
    ]);

    await analyzeSessions({ json: true });

    const output = lastJsonOutput(consoleSpy);
    expect(output.sessions).toBe(3);
    expect(output.corrections).toBe(3);
    expect(output.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'correction',
          frequency: 3,
          pattern: '我不是说',
        }),
      ]),
    );
  });

  test('--json：跨会话重复概念产出 ngram 候选', async () => {
    const ngramText = { role: 'user', content: '数据库迁移方案的详细讨论' };
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({
        id: 's1',
        turns: [ngramText, { role: 'assistant', content: '好的' }],
      }),
      mkSession({
        id: 's2',
        turns: [ngramText, { role: 'assistant', content: '明白' }],
      }),
    ]);

    await analyzeSessions({ json: true });

    const output = lastJsonOutput(consoleSpy);
    const ngramCandidates = (output.candidates as Array<{ source: string }>)
      .filter(c => c.source === 'ngram');
    expect(ngramCandidates.length).toBeGreaterThan(0);
  });
});
