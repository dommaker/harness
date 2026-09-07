/**
 * harness 包版本读取正本（#102，架构评审 A3）
 *
 * 「harness 包版本」此前散在四处五种写法（constraints.ts 带 cwd 兜底、init.ts
 * require 与内联各一份、injection-drift.ts / constraints-retire.ts __dirname
 * 相对路径）。其中 cwd 兜底在 harness 装进消费者 node_modules 且相对路径失败时
 * 会读到**消费者自己的版本号**——这是本模块要消灭的 bug。语义在此一处定义：
 *
 * - 只读本模块自身的 package.json（__dirname 相对；src 与 dist 目录深度一致，
 *   两种加载方式命中同一份清单）；
 * - 无 cwd 兜底——cwd 的 package.json 是消费者项目的，不是 harness 的；
 * - 清单缺失/损坏/无 version 字段 → 'unknown'（沿用收口前各处一致语义）。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 读取 harness 包版本；读不到（缺失/损坏/无 version 字段）返回 'unknown' */
export function getHarnessPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
