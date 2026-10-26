/**
 * run 级缓存生命周期（P1.1）：源码扫描缓存归属 RunEnv——同 run 复用、跨 run 隔离
 *
 * 旧实现把 src_scan 缓存在 ConstraintChecker 实例的 CheckCache 上（TTL 1s +
 * runAllConstraints 起始手工 invalidate），run 边界靠「复杂 TTL + 手工清缓存」
 * 掩盖，单条 check() 路径（checkConstraint 便捷函数 / getInstance 单例）无任何
 * 清理点，同进程内相邻两次调用会读到上一份 run 的陈旧扫描。
 *
 * 新契约：缓存挂在本 run 的 RunEnv 观察面上（一次 run 一份、跑完即弃），
 * 本闸钉三个行为：
 * 1. 同一枚 RunEnv 内 srcScan 同源复用（底层目录读取至多一次）
 * 2. 两枚 RunEnv 之间天然隔离（后一枚读到新写的文件）
 * 3. 全链路：同一进程内相邻两次 checkConstraint 调用，后一次必须观察到
 *    两次调用之间新出现的源文件（旧 TTL 实现下本用例红）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRunEnv } from '../run-env';
import { checkConstraint } from '../checker';
import { findTsSourceFiles } from '../../../utils/file-walk';

jest.mock('../../../utils/file-walk', () => {
  const actual = jest.requireActual<typeof import('../../../utils/file-walk')>(
    '../../../utils/file-walk'
  );
  return { ...actual, findTsSourceFiles: jest.fn(actual.findTsSourceFiles) };
});

const scanCalls = () => (findTsSourceFiles as jest.Mock).mock.calls.length;

function write(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 最小项目：一个源码根 + 一张登记了既有文件的 CAPABILITIES.md */
function fixtureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-cache-'));
  write(
    dir,
    'CAPABILITIES.md',
    ['# CAPABILITIES.md', '', '| 能力 | 路径 | 说明 |', '|---|---|---|', '| 既有 | src/existing.ts | 在 |'].join('\n') + '\n'
  );
  write(dir, 'src/existing.ts', 'export const a = 1;\n');
  return dir;
}

describe('RunEnv.srcScan：同 run 复用', () => {
  let dir: string;
  beforeEach(() => {
    dir = fixtureRoot();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('同一枚 RunEnv 内重复请求同源扫描，底层目录扫描至多一次', () => {
    const env = createRunEnv(dir);
    const before = scanCalls();

    const first = env.srcScan('src');
    const second = env.srcScan('src');

    expect(second).toEqual(first);
    expect(second).toContain('src/existing.ts');
    // 同 run 复用：真实扫描函数只被调用一次（memo 在观察面上）
    expect(scanCalls() - before).toBe(1);
    expect((findTsSourceFiles as jest.Mock).mock.calls[before][0]).toBe(path.join(dir, 'src'));
  });
});

describe('RunEnv.srcScan：跨 run 隔离', () => {
  let dir: string;
  beforeEach(() => {
    dir = fixtureRoot();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('两枚 RunEnv 各自独立：后一枚读到两次扫描之间新写的文件', () => {
    const env1 = createRunEnv(dir);
    expect(env1.srcScan('src')).toEqual(['src/existing.ts']);

    write(dir, 'src/added.ts', 'export const b = 2;\n');

    const env2 = createRunEnv(dir);
    expect(env2.srcScan('src')).toContain('src/added.ts');
  });

  it('全链路：同一进程相邻两次 checkConstraint，后一次观察到新出现的源文件', async () => {
    const context = { operation: 'file_modification' as const, projectPath: dir };

    const first = await checkConstraint('capability_sync', context);
    expect(first.evidence?.join('\n')).not.toContain('src/added.ts');

    write(dir, 'src/added.ts', 'export const b = 2;\n');

    const second = await checkConstraint('capability_sync', context);
    // capability_sync Step 2（仓库级漂移，只提示不判违规）：新文件必须进证据面
    expect(second.satisfied).toBe(true);
    expect(second.evidence?.join('\n')).toContain('src/added.ts');
  });
});
