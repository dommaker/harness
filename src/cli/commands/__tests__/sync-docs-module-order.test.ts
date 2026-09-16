/**
 * sync-docs 生成的模块清单顺序冻结（#147 B 票）
 *
 * `sync-docs` 写出的 CAPABILITIES.md 模块表格行序 = 源码目录遍历序，这个顺序此前
 * **无任何测试覆盖**，而它对外可见（`--check` 逐行比对、人工看 diff）。#147 把描述
 * 提取从串行改并发，票面裁决「输出顺序逐字保持现状」，本文件就是那条裁决的闸。
 *
 * 不写死字面顺序：`readdir` 的返回顺序由文件系统决定（本仓 tmpfs 上是字典序、ext4 上
 * 是哈希序），写死等于把断言建立在机器上。这里的口径是**目录遍历序**本身——用测试内
 * 独立推导的遍历序（`readdirSync` + 同一份跳过口径）作对照，另加两次运行的自复现，
 * 任何「按并发完成顺序 append」「改成字典序」「子目录结果挪到末尾」都会撞红。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncDocs } from '../sync-docs';
import { scanSourceModules } from '../sync-docs/project-reader';
import { captureIO } from '../../command-contract';
import { DEFAULT_SKIP_DIRS, isTsSourceFile } from '../../../utils/file-walk';

let tempDir: string;
const io = captureIO();

function write(rel: string, content: string): void {
  const target = path.join(tempDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 口径对照：目录遍历序 = readdir 序，子目录结果就地展开在父条目所在位置 */
function traversalOrder(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (DEFAULT_SKIP_DIRS.includes(entry)) continue;
    const entryPath = path.join(dir, entry);
    if (fs.statSync(entryPath).isDirectory()) {
      out.push(...traversalOrder(entryPath, root));
    } else if (isTsSourceFile(entry, { skipIndex: true, includeTsx: true })) {
      out.push(path.relative(root, entryPath));
    }
  }
  return out;
}

/** 生成后的 CAPABILITIES.md 表格行序（文件列） */
function tableRows(capabilitiesPath: string): string[] {
  return fs
    .readFileSync(capabilitiesPath, 'utf-8')
    .split('\n')
    .filter((line) => /^\|[^|]+\|[^|]+\.tsx?\s*\|[^|]+\|\s*$/.test(line))
    .map((line) => line.split('|')[2].trim());
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd147-module-order-'));
  // 一个子目录恰好排在两份顶层文件之间（顺序若被重排，这里最容易露馅）
  write('src/alpha.ts', '// 描述-甲\nexport const a = 1;\n');
  write('src/mid/beta.ts', '/**\n * 描述-乙\n */\nexport const b = 1;\n');
  write('src/mid/gamma.ts', '// 描述-丙\nexport const c = 1;\n');
  write('src/zeta.ts', '// 描述-丁\nexport const d = 1;\n');
  // 同一条规则下的旁支：barrel 与 .d.ts 不进清单
  write('src/index.ts', 'export * from "./alpha";\n');
  write('src/ambient.d.ts', 'export const t = 1;\n');
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('sync-docs 模块清单顺序冻结（#147）', () => {
  it('扫描产出的清单顺序 = 目录遍历序，且描述与文件配对不串位', async () => {
    const modules = await scanSourceModules(path.join(tempDir, 'src'), tempDir);
    const expected = traversalOrder(path.join(tempDir, 'src'), tempDir);

    expect(modules.map((m) => m.file)).toEqual(expected);
    // 并发取数后每条描述仍是自己那份文件的（回填按原索引，不按完成先后）
    expect(modules.map((m) => `${m.file}=${m.description}`).sort()).toEqual(
      [
        'src/alpha.ts=描述-甲',
        'src/mid/beta.ts=描述-乙',
        'src/mid/gamma.ts=描述-丙',
        'src/zeta.ts=描述-丁',
      ].sort()
    );
  });

  it('写出的 CAPABILITIES.md 行序 = 同一次扫描的清单顺序（对外可见面被锁住）', async () => {
    const capPath = path.join(tempDir, 'CAPABILITIES.md');
    expect(fs.existsSync(capPath)).toBe(false);

    await syncDocs({ projectPath: tempDir }, io);

    expect(tableRows(capPath)).toEqual(traversalOrder(path.join(tempDir, 'src'), tempDir));
  });

  it('同一次生成的清单顺序两次运行逐字复现（并发不引入运行间抖动）', async () => {
    const capPath = path.join(tempDir, 'CAPABILITIES.md');

    fs.rmSync(capPath, { force: true });
    await syncDocs({ projectPath: tempDir }, io);
    const first = tableRows(capPath);
    expect(first.length).toBe(4);

    fs.rmSync(capPath, { force: true });
    await syncDocs({ projectPath: tempDir }, io);

    expect(tableRows(capPath)).toEqual(first);
    fs.rmSync(capPath, { force: true });
  });
});
