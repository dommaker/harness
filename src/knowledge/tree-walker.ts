/**
 * 知识树布局正本（harness#134：walker 排除口径单点化）
 *
 * 「什么算条目」的唯一判定。此前 store 顶层扫描、migration 顶层扫描、index-generator
 * 递归扫描各有各的排除口径，后果是 `knowledge index` 落在 baseDir 的生成物 `_index.md`
 * 被 `knowledge migrate` 判成「no frontmatter found」计入 errors——同一份树，两个命令两套人口。
 *
 * 本模块只管**排除口径**，不管遍历深度：store 与 migration 是顶层扫描器，index-generator
 * 会下钻业务子目录（`skills/`、`arch-patterns/`），那是各自的功能而非口径分歧。
 */

/** 索引生成物：由 `harness knowledge index` 落在 baseDir，是树的基建不是条目 */
export const INDEX_MD_FILE = '_index.md';

/** 快照目录：`store.snapshot()` 的落点 */
export const SNAPSHOTS_DIR = '.snapshots';

/** 树基建目录：归档区 / 快照区 / 决议区，任何 walker 都不把它们的内容当条目人口 */
const INFRA_DIRS = ['.archive', 'archived', SNAPSHOTS_DIR, 'resolutions'];

/** 目录名是否属于树基建 */
export function isInfraDir(name: string): boolean {
  return INFRA_DIRS.includes(name);
}

/** 文件名是否是知识条目（.md 且非生成物） */
export function isEntryFile(name: string): boolean {
  return name.endsWith('.md') && name !== INDEX_MD_FILE;
}
