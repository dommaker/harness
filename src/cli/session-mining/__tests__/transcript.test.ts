/**
 * readTranscriptSessions 坏行/null 记录容错测试（harness#82）
 *
 * transcript 行可 parse 但值为 null（或提取异常）时，
 * 与原逐行 catch 实现一致：该条跳过，不影响其余记录。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readTranscriptSessions } from '../transcript';

describe('readTranscriptSessions 坏行容错（harness#82）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-transcript-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('null 行与坏行只丢该行，合法 turn 照常提取', () => {
    const lines = [
      JSON.stringify({ message: { role: 'user', content: 'hello' } }),
      'null', // parse 合法但值为 null，原实现经逐行 catch 跳过
      '{"broken',
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    ];
    fs.writeFileSync(path.join(dir, 'session-a.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const sessions = readTranscriptSessions(dir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].turns.map(t => t.role)).toEqual(['user', 'assistant']);
    expect(sessions[0].turns[1].content).toBe('hi');
  });

  it('目录不可读返回空数组', () => {
    expect(readTranscriptSessions(path.join(dir, 'missing'))).toEqual([]);
  });
});
