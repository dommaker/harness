/**
 * capabilities-reconcile 纯判定测试（ADR-0009）
 *
 * interface 即测试面：喂文档内容与文件清单，断言判定结果；无 fs/git fixture。
 */

import {
  reconcileCapabilities,
  significantCodeChanges,
  collectSourceFiles,
} from '../capabilities-reconcile';

const TABLE = [
  '| 模块 | 文件 | 说明 |',
  '|------|------|------|',
  '| Core | src/core/checker.ts | 引擎 |',
  '| Gates | src/gates/ | 门禁目录 |',
].join('\n');

function withExtras(extraLines: string[]): string {
  return [TABLE, ...extraLines].join('\n');
}

describe('reconcileCapabilities — 解析口径', () => {
  it('收集所有单元格的文件与目录条目，不再只看第二列', () => {
    const content = withExtras(['| src/utils/helper.ts | 名字在首列 | x |']);
    const v = reconcileCapabilities({
      content,
      populationFiles: [],
    });
    expect(v.fileEntries).toContain('src/core/checker.ts');
    expect(v.fileEntries).toContain('src/utils/helper.ts');
    expect(v.dirEntries).toEqual(['src/gates/']);
  });

  it('hasTable 区分散文文档与有表格零条目；listingFormat 识别计数行', () => {
    expect(reconcileCapabilities({ content: '随便写点什么', populationFiles: [] }).hasTable).toBe(false);
    const emptyTable = '| 模块 | 文件 |\n|---|---|';
    expect(reconcileCapabilities({ content: emptyTable, populationFiles: [] }).hasTable).toBe(true);
    const listing = '# 能力\nCLI Commands (9)\nIron Laws (3)';
    expect(reconcileCapabilities({ content: listing, populationFiles: [] }).listingFormat).toBe(true);
  });
});

describe('reconcileCapabilities — 代码→文档（漏登记）', () => {
  const population = ['src/core/checker.ts', 'src/gates/command.ts', 'src/knowledge/store.ts'];

  it('module 模式：目录条目参与覆盖，未覆盖文件聚合为目录', () => {
    const v = reconcileCapabilities({
      content: TABLE,
      populationFiles: population,
      sourceRoots: ['src'],
    });
    expect(v.uncoveredFiles).toEqual(['src/knowledge/store.ts']);
    expect(v.uncoveredDirs).toEqual(['src/knowledge/']);
  });

  it('目录条目恒参与覆盖（check/fix 同规则），mode 只是调用方取哪份输出形状', () => {
    const v = reconcileCapabilities({
      content: TABLE,
      populationFiles: population,
      sourceRoots: ['src'],
    });
    expect(v.coverageEntries).toContain('src/gates/');
    expect(v.uncoveredFiles).toEqual(['src/knowledge/store.ts']);
    // file 模式调用方读 uncoveredFiles；module 模式读 uncoveredDirs——同一判定两种投影
    expect(v.uncoveredDirs).toEqual(['src/knowledge/']);
  });

  it('文件条目路径边界后缀匹配：兼容 basename 登记但拒绝模糊碰撞', () => {
    const content = withExtras(['| 局部 | core/checker.ts | 相对路径条目 |']);
    const v = reconcileCapabilities({
      content,
      populationFiles: ['src/core/checker.ts', 'src/otherchecker.ts', 'src/docs/src/checked.ts'],
    });
    expect(v.uncoveredFiles).toEqual(['src/otherchecker.ts', 'src/docs/src/checked.ts']);
  });

  it('增量判定独立于全量：changedFiles 未被覆盖的进入 uncoveredChanges', () => {
    const v = reconcileCapabilities({
      content: TABLE,
      populationFiles: population,
      changedFiles: ['src/core/checker.ts', 'src/knowledge/store.ts'],
      sourceRoots: ['src'],
    });
    expect(v.uncoveredChanges).toEqual(['src/knowledge/store.ts']);
  });
});

describe('reconcileCapabilities — 文档→代码（幽灵）', () => {
  it('文件条目多根相对路径：项目根或任一源码根下存在即算活', () => {
    const content = '| 模块 | 文件 | 说明 |\n|---|---|---|\n| API | apps/routes.ts | studio 式多根 |';
    const v = reconcileCapabilities({
      content,
      populationFiles: [],
      sourceRoots: ['src', 'apps/api'],
      fileExists: (rel) => rel === 'apps/api/apps/routes.ts',
    });
    expect(v.deadEntries).toEqual([]);
  });

  it('目录条目也查幽灵（口径从严，Q6a）：磁盘不存在且实况无文件才算死', () => {
    const v = reconcileCapabilities({
      content: TABLE,
      populationFiles: ['src/core/checker.ts'],
      fileExists: (rel) => !rel.startsWith('src/gates'),
    });
    expect(v.deadEntries).toEqual(['src/gates/']);
  });

  it('目录条目实况有文件即活（oracle 缺省的纯清单场景）', () => {
    const v = reconcileCapabilities({
      content: TABLE,
      populationFiles: ['src/core/checker.ts', 'src/gates/command.ts'],
    });
    expect(v.deadEntries).toEqual([]);
  });

  it('裸文件名条目按实况兜底：无任何文件命中才算幽灵', () => {
    const content = withExtras(['| 别名 | routes.ts | 裸 basename |']);
    const v = reconcileCapabilities({
      content,
      populationFiles: [
        'src/core/checker.ts',
        'src/gates/command.ts',
        'src/agent-configs/routes.ts',
      ],
    });
    expect(v.deadEntries).toEqual([]);
  });

  it(' basename 碰撞场景：全路径幽灵即使同名文件存活仍被报出（2026-08-08 事故回归）', () => {
    const content = withExtras(['| 旧 | src/agent-configs/routes.ts | 已删 |']);
    const v = reconcileCapabilities({
      content,
      populationFiles: ['src/agents/routes.ts'],
      fileExists: () => false,
    });
    expect(v.deadEntries).toContain('src/agent-configs/routes.ts');
  });
});

describe('significantCodeChanges', () => {
  it('只留有意义的代码变更：扩展名过滤 + 排除测试文件', () => {
    const names = [
      'src/core/checker.ts',
      'src/web/App.tsx',
      'scripts/run.js',
      'src/__tests__/checker-extra.test.ts',
      'src/core/checker.test.ts',
      'src/core/checker.spec.ts',
      'docs/readme.md',
      'package.json',
    ];
    expect(significantCodeChanges(names)).toEqual([
      'src/core/checker.ts',
      'src/web/App.tsx',
      'scripts/run.js',
    ]);
  });
});

describe('collectSourceFiles', () => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-scan-'));
    fs.mkdirSync(path.join(tmpDir, 'src/core'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/__tests__'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/core/index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src/core/foo.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src/core/types.d.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src/core/App.tsx'), '');
    fs.writeFileSync(path.join(tmpDir, 'src/__tests__/foo.test.ts'), '');
  });

  it('返回项目相对路径；跳过 barrel/声明文件/测试目录；默认不含 tsx', () => {
    expect(collectSourceFiles(tmpDir, ['src']).sort()).toEqual(['src/core/foo.ts']);
  });

  it('includeTsx 时纳入 .tsx', () => {
    expect(collectSourceFiles(tmpDir, ['src'], { includeTsx: true }).sort()).toEqual([
      'src/core/App.tsx',
      'src/core/foo.ts',
    ]);
  });

  it('多根收集并集', () => {
    fs.mkdirSync(path.join(tmpDir, 'apps/api/src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'apps/api/src/main.ts'), '');
    expect(collectSourceFiles(tmpDir, ['src', 'apps/api/src']).sort()).toEqual([
      'apps/api/src/main.ts',
      'src/core/foo.ts',
    ]);
  });
});
