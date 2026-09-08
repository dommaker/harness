/**
 * tools 能力目录 registry 完整性测试（架构评审 2026-09-02 候选12 / harness#91）
 *
 * `src/tools/definitions/` 是随包发布的数据（package.json files 含 src），studio 经包根
 * 公开导出消费（`getToolsDir` / `getRegistryPath`）——此前代码半边有 public-exports 钉住导出面，
 * 数据半边零测试：幽灵项 / 漏登项 / path 悬空 / name 漂移都没人守。
 * 这是 ADR-0002「注册型能力一律定义即注册 + 构建期闭环」唯一没覆盖的一类注册表。
 *
 * 裁决（#91 triage）：
 * - **yml 目录是正本**，registry.json 是派生索引 → 对照方向 = 双向集合一致
 * - **不做 yml schema 校验**（那等于替 studio 定能力契约，破坏面外溢到 studio）
 * - `rollback` 重名 ×2（std/deploy 与 std/governance）是既有事实，进豁免名单；
 *   重名本身是否合法另票裁决 → 名单外的任何新重名一律红
 *
 * 判定形状参照 ADR-0009 的 reconcile：读声明 → 对照文件系统 → 产出双向差异清单，
 * 失败信息一次报全（不逐条断言到第一个错就停）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getRegistryPath, getToolsDir } from '../paths';
import { walkFiles } from '../../utils/file-walk';
import { createProjectFixture } from '../../test-setup/project-fixture';

/** registry.json 条目（只取本测试关心的两字段，schema 校验是 out of scope） */
interface RegistryEntry {
  name: string;
  path: string;
}

/** 一个 tools 定义目录的读取结果：派生索引声明 + 正本文件清单 + 正本内 name */
interface DefinitionsSnapshot {
  /** registry.json 声明的条目 */
  entries: RegistryEntry[];
  /** definitions/ 下实际存在的 yml（相对定义根，`/` 分隔） */
  ymlPaths: string[];
  /** yml 内 name（相对路径 → name；读不到/非字符串 → null） */
  ymlNames: Record<string, string | null>;
}

/** 双向漂移清单（ADR-0009 形状：一次产出全部判定，消费方按需取用） */
interface RegistryDrift {
  /** 幽灵项：registry 登记了磁盘上不存在的 yml（含 path 悬空） */
  ghostPaths: string[];
  /** 漏登项：磁盘上的 yml 未被 registry 任何条目引用 */
  unregisteredPaths: string[];
  /** name 漂移：registry.name 与 yml 内 name 不一致（含 yml 缺 name） */
  nameMismatches: string[];
  /** 重名：同 name 被多条条目使用（排序） */
  duplicateNames: string[];
}

/** 既有事实豁免：#91 裁决保留的重名，名单外新增即红 */
const KNOWN_DUPLICATE_NAMES = ['rollback'];

const EMPTY_DRIFT: RegistryDrift = {
  ghostPaths: [],
  unregisteredPaths: [],
  nameMismatches: [],
  duplicateNames: [],
};

/** 读一个定义目录：registry.json 声明 + yml 正本清单与其中的 name（相对路径统一 `/` 分隔） */
function readDefinitions(definitionsDir: string): DefinitionsSnapshot {
  const registry = JSON.parse(fs.readFileSync(path.join(definitionsDir, 'registry.json'), 'utf-8')) as {
    tools: RegistryEntry[];
  };
  const ymlPaths = walkFiles(definitionsDir, { filter: name => name.endsWith('.yml') })
    .map(full => path.relative(definitionsDir, full).split(path.sep).join('/'))
    .sort();
  const ymlNames: Record<string, string | null> = {};
  for (const rel of ymlPaths) {
    const doc = yaml.load(fs.readFileSync(path.join(definitionsDir, rel), 'utf-8')) as
      | { name?: unknown }
      | undefined;
    ymlNames[rel] = typeof doc?.name === 'string' ? doc.name : null;
  }
  return { entries: registry.tools, ymlPaths, ymlNames };
}

/** 双向对照（纯判定，不做 IO——ADR-0009 同口径） */
function reconcileRegistry(snapshot: DefinitionsSnapshot): RegistryDrift {
  const ymlSet = new Set(snapshot.ymlPaths);
  const declaredPaths = new Set<string>();
  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const ghostPaths: string[] = [];
  const nameMismatches: string[] = [];

  for (const entry of snapshot.entries) {
    declaredPaths.add(entry.path);
    if (!ymlSet.has(entry.path)) {
      ghostPaths.push(entry.path);
      continue; // 正本不存在，name 无从对照（幽灵项已含该条）
    }
    const ymlName = snapshot.ymlNames[entry.path];
    if (ymlName !== entry.name) {
      nameMismatches.push(
        `${entry.path}: registry="${entry.name}" ${ymlName === null ? 'yml=<缺失>' : `yml="${ymlName}"`}`
      );
    }
    if (seenNames.has(entry.name)) duplicateNames.add(entry.name);
    seenNames.add(entry.name);
  }

  return {
    ghostPaths: ghostPaths.sort(),
    unregisteredPaths: snapshot.ymlPaths.filter(p => !declaredPaths.has(p)).sort(),
    nameMismatches: nameMismatches.sort(),
    duplicateNames: [...duplicateNames].sort(),
  };
}

/** 临时定义根夹具（经 project-fixture 建根，afterAll 由 mkdtemp-cleanup 回收） */
function makeDefinitionsFixture(
  label: string,
  tools: RegistryEntry[],
  ymls: Record<string, string>
): string {
  const files: Record<string, string> = {
    'definitions/registry.json': JSON.stringify({ tools }, null, 2),
  };
  for (const [rel, content] of Object.entries(ymls)) files[`definitions/${rel}`] = content;
  return path.join(createProjectFixture({ name: `tools-registry-${label}`, files }), 'definitions');
}

const CLEAN_TOOLS: RegistryEntry[] = [
  { name: 'code/parse', path: 'core/code/parse.yml' },
  { name: 'deploy/rollback', path: 'std/deploy/rollback.yml' },
];
const CLEAN_YMLS = {
  'core/code/parse.yml': 'name: code/parse\ndescription: parse\n',
  'std/deploy/rollback.yml': 'name: deploy/rollback\ndescription: rollback\n',
};

describe('tools registry 完整性 — 判定形状（ADR-0009 reconcile）', () => {
  it('干净夹具：双向零漂移（不误报）', () => {
    const snapshot = readDefinitions(makeDefinitionsFixture('clean', CLEAN_TOOLS, CLEAN_YMLS));
    expect(reconcileRegistry(snapshot)).toEqual(EMPTY_DRIFT);
  });

  it('幽灵项 / path 悬空：registry 登记磁盘不存在的 yml → 红（闭环失败方向 1）', () => {
    const snapshot = readDefinitions(
      makeDefinitionsFixture('ghost', [...CLEAN_TOOLS, { name: 'ghost/item', path: 'std/ghost/item.yml' }], CLEAN_YMLS)
    );
    expect(reconcileRegistry(snapshot).ghostPaths).toEqual(['std/ghost/item.yml']);
  });

  it('漏登项：yml 存在但 registry 未登记 → 红（闭环失败方向 2）', () => {
    const snapshot = readDefinitions(
      makeDefinitionsFixture(
        'missing',
        CLEAN_TOOLS,
        { ...CLEAN_YMLS, 'std/unlisted/new-tool.yml': 'name: unlisted/new-tool\n' }
      )
    );
    expect(reconcileRegistry(snapshot).unregisteredPaths).toEqual(['std/unlisted/new-tool.yml']);
  });

  it('name 漂移：registry.name 与 yml 内 name 不一致 → 红', () => {
    const snapshot = readDefinitions(
      makeDefinitionsFixture('name-drift', CLEAN_TOOLS, {
        ...CLEAN_YMLS,
        'core/code/parse.yml': 'name: code/renamed\ndescription: parse\n',
      })
    );
    expect(reconcileRegistry(snapshot).nameMismatches).toEqual([
      'core/code/parse.yml: registry="code/parse" yml="code/renamed"',
    ]);
  });

  it('yml 缺 name 字段 → 计入 name 漂移（不做 schema 校验，但 name 是对照锚点）', () => {
    const snapshot = readDefinitions(
      makeDefinitionsFixture('name-absent', CLEAN_TOOLS, {
        ...CLEAN_YMLS,
        'core/code/parse.yml': 'description: parse\n',
      })
    );
    expect(reconcileRegistry(snapshot).nameMismatches).toEqual([
      'core/code/parse.yml: registry="code/parse" yml=<缺失>',
    ]);
  });

  it('豁免名单外的新重名 → 红（rollback 重名合法性另票裁决，#91）', () => {
    const snapshot = readDefinitions(
      makeDefinitionsFixture(
        'dup',
        [...CLEAN_TOOLS, { name: 'deploy/rollback', path: 'std/governance/rollback.yml' }],
        { ...CLEAN_YMLS, 'std/governance/rollback.yml': 'name: deploy/rollback\n' }
      )
    );
    expect(reconcileRegistry(snapshot).duplicateNames).toEqual(['deploy/rollback']);
  });
});

describe('tools registry 完整性 — 真实数据（definitions/ 随包发布）', () => {
  const snapshot = readDefinitions(getToolsDir());

  it('yml 正本与 registry 派生索引双向一致：无幽灵、无漏登、path 全部指向存在的 yml', () => {
    const drift = reconcileRegistry(snapshot);
    expect({ ...drift, duplicateNames: drift.duplicateNames.filter(n => !KNOWN_DUPLICATE_NAMES.includes(n)) })
      .toEqual(EMPTY_DRIFT);
  });

  it('重名豁免名单钉死：当前唯一重名 = rollback ×2，名单变化即红', () => {
    expect(reconcileRegistry(snapshot).duplicateNames).toEqual(KNOWN_DUPLICATE_NAMES);
  });

  it('src/tools/CONTEXT.md 声明的 yml 计数与实际一致', () => {
    const contextSource = fs.readFileSync(path.join(getToolsDir(), '..', 'CONTEXT.md'), 'utf-8');
    const declared = contextSource.match(/(\d+) 个 yml/);
    expect(declared).not.toBeNull();
    expect(Number(declared?.[1])).toBe(snapshot.ymlPaths.length);
  });

  it('包根公开导出的两个路径入口指向存在的 definitions/ 与 registry.json（studio 消费面）', () => {
    expect(fs.existsSync(getToolsDir())).toBe(true);
    expect(fs.existsSync(getRegistryPath())).toBe(true);
  });
});
