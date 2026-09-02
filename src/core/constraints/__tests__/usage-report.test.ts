/**
 * readProjectTraces 坏行 fixture（harness#82）
 *
 * 三种现行响应例证之「静默跳过」（原语义不变）：
 * traces.log 单行损坏时 report 数据层不失败，返回全部合法 trace。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readProjectTraces } from '../usage-report';
import { DEFAULT_TRACE_FILE } from '../../../types/trace';

describe('readProjectTraces 坏行容错（harness#82）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-usage-report-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeTraces(lines: string[]): void {
    const tracePath = path.join(root, DEFAULT_TRACE_FILE);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(tracePath, lines.join('\n') + '\n', 'utf-8');
  }

  it('坏行静默跳过，返回全部合法 trace', () => {
    writeTraces([
      '{"constraintId":"a","level":"iron_law","timestamp":1,"result":"pass"}',
      '{"constraintId":"b","broken',
      '{"constraintId":"c","level":"iron_law","timestamp":3,"result":"fail"}',
    ]);
    const traces = readProjectTraces(root);
    expect(traces.map(t => t.constraintId)).toEqual(['a', 'c']);
  });

  it('缺文件返回空数组', () => {
    expect(readProjectTraces(root)).toEqual([]);
  });
});
