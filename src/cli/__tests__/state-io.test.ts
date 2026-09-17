/**
 * fileStateIO 直测（ADR-0026）：真实 fs、临时目录，不 mock。
 *
 * 命令侧注入面见 check.test.ts / status.test.ts 的内存假件；
 * 本套件只钉缺省实现自身的语义：缺失 → {}、写-读回环、损坏照现状抛、路径锚 projectPath。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileStateIO } from '../state-io';

describe('fileStateIO（真实 fs 缺省实现，ADR-0026）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-state-io-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('文件缺失 → read() 返回 {}', () => {
    expect(fileStateIO(dir).read()).toEqual({});
  });

  it('空文件（0 字节）→ read() 返回 {}（ADR-0026 决策 1「缺失/空」口径）', () => {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.harness', '.state.json'), '');

    expect(fileStateIO(dir).read()).toEqual({});
  });

  it('写-读回环：write() 自动建目录，落点锚 projectPath 下的 .harness/.state.json', () => {
    const stateIO = fileStateIO(dir);
    stateIO.write({ shownHints: ['trace_50'], lastStatusRun: '2026-09-17T00:00:00.000Z' });

    const onDisk = path.join(dir, '.harness', '.state.json');
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(stateIO.read()).toEqual({ shownHints: ['trace_50'], lastStatusRun: '2026-09-17T00:00:00.000Z' });
  });

  it('损坏文件照现状抛（不兜底成 {}，ADR-0026 决策 4）', () => {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.harness', '.state.json'), 'not json');

    expect(() => fileStateIO(dir).read()).toThrow();
  });
});
