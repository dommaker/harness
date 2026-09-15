/**
 * sync-docs 的 CONTEXT.md 落点测试（harness#150）
 *
 * #132 把 init/validate 的脚手架三态收进 scaffold 模块，但 sync-docs 的
 * `createContextMd` 是票口径外的第 9 处同形写手：自带一份 CONTEXT.md 模板正文，
 * 与正本 `renderContextDoc` 已漂移。本票把它改消费正本（contextDocFile + runPlan）。
 *
 * 这里零真实文件系统（注入内存 fs 替身，手法照 scaffold.test.ts）钉三件事：
 * 1. 对撞：同一目录经 init（contextDocFile）与 sync-docs（createContextMd）生成的
 *    CONTEXT.md 骨架逐字相同（两条路径归一到单一正本）。
 * 2. 正本文案：并入副本独有的两行引导、四节占位取 HTML 注释形。
 * 3. 只在缺失时写：present → exists 分支不覆盖，正常 contextMissing 只走 created。
 */

import * as path from 'path';
import chalk from 'chalk';
import { captureIO, type CapturingIO } from '../../command-contract';
import { contextDocFile, type ScaffoldFileSystem } from '../scaffold';
import { createContextMd } from '../sync-docs/context-syncer';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

/** 内存 fs 替身：写盘内容、建过的目录可断言 */
class MemoryFs implements ScaffoldFileSystem {
  readonly files = new Map<string, string>();
  readonly dirs: string[] = [];

  seed(target: string, content: string): void {
    this.files.set(target, content);
  }
  async exists(target: string): Promise<boolean> {
    return this.files.has(target);
  }
  async mkdir(dir: string): Promise<void> {
    this.dirs.push(dir);
  }
  async writeFile(target: string, content: string): Promise<void> {
    this.files.set(target, content);
  }
  async chmod(): Promise<void> {
    /* CONTEXT.md 无权限位 */
  }
}

const PROJECT = '/srv/project';
const USER_CONTENT = '# src\n\n我自己写的，不许覆盖\n';

let fs: MemoryFs;
let io: CapturingIO;

beforeEach(() => {
  jest.clearAllMocks();
  fs = new MemoryFs();
  io = captureIO();
});

describe('createContextMd 消费 scaffold 正本（harness#150）', () => {
  it('对撞：sync-docs 落点与 init 站点生成的骨架逐字相同', async () => {
    await expect(createContextMd(PROJECT, 'src', io, fs)).resolves.toBe('created');
    const written = fs.files.get(path.join(PROJECT, 'src', 'CONTEXT.md'));

    // init 侧经由同一个 contextDocFile 工厂落盘（见 init.ts 的 contextDocPlan）——
    // 两侧共用单一正本，任何一份偷偷漂移都会在这里撞红
    expect(written).toBe(contextDocFile(PROJECT, 'src').content);
  });

  it('正本文案钉住：并入的两行引导 + 注释形占位（散文式提问已消失）', async () => {
    const content = contextDocFile(PROJECT, 'src').content;

    expect(content).toContain('> 请阅读本目录的源代码，然后填写以下各节。');
    expect(content).toContain(
      '> 如果使用 AI 编码助手，将本文件内容作为 prompt 请求它分析并填写。',
    );
    expect(content).toContain('<!-- 本目录的核心职责是什么 -->');
    expect(content).not.toContain('本目录的核心职责是？');
  });

  it('缺失才写：present → exists 分支，用户内容一字节不动', async () => {
    const target = path.join(PROJECT, 'src', 'CONTEXT.md');
    fs.seed(target, USER_CONTENT);

    await expect(createContextMd(PROJECT, 'src', io, fs)).resolves.toBe('exists');

    expect(fs.files.get(target)).toBe(USER_CONTENT);
    expect(fs.dirs).toEqual([]);
    expect(printed(io)).toEqual(['src/CONTEXT.md 已存在']);
    expect(chalk.gray).toHaveBeenCalledWith('src/CONTEXT.md 已存在');
  });

  it('created 态：绿字文案由 runPlan 打印，与 init 落盘态同源', async () => {
    await createContextMd(PROJECT, 'src', io, fs);

    expect(printed(io)).toEqual(['✅ 已创建 src/CONTEXT.md']);
    expect(chalk.green).toHaveBeenCalledWith('✅ 已创建 src/CONTEXT.md');
  });
});

/** stdout 每次写入的文本（去掉 log 补的换行） */
function printed(capture: CapturingIO): string[] {
  return capture.outRecords().map(chunk => chunk.replace(/\n$/, ''));
}
