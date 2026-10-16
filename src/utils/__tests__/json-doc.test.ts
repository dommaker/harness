/**
 * utils/json-doc — readJsonDocIfExists 正本测试（重构班次 3 Phase 3）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonDocIfExists } from '../json-doc';

describe('readJsonDocIfExists', () => {
  it('文件不存在 → undefined（合法空，不抛）', () => {
    expect(readJsonDocIfExists('/nonexistent/dir/nope.json')).toBeUndefined();
  });

  it('在场且合法 → 解析结果（保类型参数形状）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-json-doc-'));
    const file = path.join(dir, 'doc.json');
    fs.writeFileSync(file, JSON.stringify({ dailyEvents: 7 }));
    expect(readJsonDocIfExists<{ dailyEvents: number }>(file)).toEqual({ dailyEvents: 7 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('在场但 JSON 损坏 → 抛出 fail-fast（损坏 ≠ 缺失）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-json-doc-'));
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{ not json');
    expect(() => readJsonDocIfExists(file)).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
