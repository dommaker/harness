/**
 * update-user-model 命令测试（O1：--days flag + --json/--dry-run 兼容）
 *
 * Seam：updateUserModel(options) 公开入口。
 * 隔离面：
 *   - os.homedir → 测试临时目录（state/profile 落 TEST_HOME，不触碰真实 ~/.claude）
 *   - readTranscriptSessions → fixture 会话（extractCorrectionMatches 等纯函数保持真实）
 */

import * as fs from 'fs';
import * as path from 'path';
import { updateUserModel } from '../update-user-model';
import { readTranscriptSessions, type MinedSession } from '../../session-mining';

const TEST_HOME = '/tmp/harness-uum-test-home';

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => '/tmp/harness-uum-test-home',
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

const STATE_FILE = path.join(TEST_HOME, '.claude', 'user-model-state.json');

function todayStr(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function mkSession(partial: Partial<MinedSession> = {}): MinedSession {
  return {
    id: 'session-1',
    date: todayStr(),
    mtimeMs: Date.now(),
    turns: [
      { role: 'user', content: '数据库迁移方案需要执行' },
      { role: 'assistant', content: '好的' },
    ],
    toolCalls: ['Read'],
    ...partial,
  };
}

function lastJsonOutput(consoleSpy: jest.SpyInstance): Record<string, unknown> {
  const jsonLine = consoleSpy.mock.calls.map(c => c[0]).join('\n');
  return JSON.parse(jsonLine);
}

describe('update-user-model command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_HOME, '.claude', 'projects', '-root-projects', 'memory'), { recursive: true });
    process.env.CLAUDE_TRANSCRIPTS_DIR = path.join(TEST_HOME, 'transcripts');
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.CLAUDE_TRANSCRIPTS_DIR;
  });

  test('无新会话：提示 No new sessions to process', async () => {
    mockReadTranscriptSessions.mockReturnValue([]);

    await updateUserModel({});

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No new sessions to process'));
    expect(fs.existsSync(STATE_FILE)).toBe(false);
  });

  test('--json：输出 newSessions 与 new_pattern 变化', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'session-a' }),
      mkSession({ id: 'session-b' }),
    ]);

    await updateUserModel({ json: true, dryRun: true });

    const output = lastJsonOutput(consoleSpy);
    expect(output.newSessions).toBe(2);
    expect(output.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'new_pattern',
          key: '数据库迁移方案需要执行',
        }),
      ]),
    );
  });

  test('--dry-run：只展示变化，不写 state 文件', async () => {
    mockReadTranscriptSessions.mockReturnValue([mkSession({ id: 'session-a' })]);

    await updateUserModel({ dryRun: true });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Processed 1 new sessions'));
    expect(fs.existsSync(STATE_FILE)).toBe(false);
  });

  test('默认（非 dry-run）：落盘 state 并记录已处理会话', async () => {
    mockReadTranscriptSessions.mockReturnValue([mkSession({ id: 'session-a' })]);

    await updateUserModel({});

    expect(fs.existsSync(STATE_FILE)).toBe(true);
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    expect(state.sessionsProcessed).toContain('session-a');
  });

  test('--days 1：只处理最近 1 天的会话', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'today' }),
      mkSession({
        id: 'three-days-ago',
        date: todayStr(3),
        turns: [
          { role: 'user', content: '旧会话概念内容测试' },
          { role: 'assistant', content: '' },
        ],
      }),
    ]);

    await updateUserModel({ json: true, dryRun: true, days: 1 });

    const output = lastJsonOutput(consoleSpy);
    expect(output.newSessions).toBe(1);
  });

  test('缺省 --days：处理全部未处理会话（向后兼容）', async () => {
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'today' }),
      mkSession({
        id: 'three-days-ago',
        date: todayStr(3),
        turns: [
          { role: 'user', content: '旧会话概念内容测试' },
          { role: 'assistant', content: '' },
        ],
      }),
    ]);

    await updateUserModel({ json: true, dryRun: true });

    const output = lastJsonOutput(consoleSpy);
    expect(output.newSessions).toBe(2);
  });

  test('sessionsProcessed 去重：已处理会话不重复计入（与 --days 正交）', async () => {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        lastUpdated: '',
        sessionsProcessed: ['session-a'],
        patterns: {},
        lensWeights: {},
        principleWeights: {},
        evolutionLog: [],
      }),
      'utf-8',
    );
    mockReadTranscriptSessions.mockReturnValue([
      mkSession({ id: 'session-a' }),
      mkSession({ id: 'session-b' }),
    ]);

    await updateUserModel({ json: true, dryRun: true, days: 7 });

    const output = lastJsonOutput(consoleSpy);
    expect(output.newSessions).toBe(1);
  });
});
