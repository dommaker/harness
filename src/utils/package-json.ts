/**
 * package.json 读取正本（重构 Phase 5 收口）
 *
 * 「读一份 dir/package.json」此前散在 7 处四种写法（release/integrity 包根探测与
 * 发布面推导、knowledge/cold-start 技术栈扫描、sync-docs project-reader、passes-gate
 * 测试命令探测、spec-baseline 依赖面、release 命令、utils/package-version 自身
 * 版本），read → parse 链各写一遍。语义在此一处定义：
 *
 * - 缺失 → null（「没有清单」是合法输入，由调用方按各自语义处理：
 *   探测类继续向上找/换项目类型，门槛类返回 gateFail）；
 * - 在场但 JSON 损坏、或读失败（权限等）→ 抛出（fail-fast：损坏清单 ≠ 没有清单，
 *   不装 null）。
 *
 * 实现口径：单次 readFileSync + ENOENT 窄化 catch（非 ENOENT 一律上抛），刻意不用
 * existsSync 预探测——exists+read 是两次底层读取，spec-baseline 的 #146 读取计数闸
 * 冻结「同一落点一次运行一遍」会因此翻倍；ENOENT 窄化不是吞错（其余异常原样上抛），
 * 与 src/CONTEXT.md「存在性探测用 existsSync 而非 try/catch」不冲突——本函数不是
 * 探测存在性做分支，是读取并定义缺失语义。
 *
 * 记名豁免：`core/constraints/doc-freshness/runner.ts` 的 changelog_version 检查
 * 读的是 config.yml 可配置的清单路径（`check.package_json || 'package.json'`，
 * 文件名非常量），且缺失语义是「无检查对象按 pass 跳过」，不进本正本。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * package.json 常见字段形状（只声明仓内消费方实际取用的字段）
 *
 * 类型别名而非 interface：保留隐式索引签名，兼容 `Record<string, unknown>` 形参
 * 与 `T extends PackageJson` 的窄化泛型实参（如 release/integrity 的
 * PackagePublishManifest）。
 */
export type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * 读取 dir/package.json：缺失 → null；在场但 JSON 损坏/读失败 → 抛出（fail-fast）
 *
 * 一次底层读取完成判定（ENOENT = 缺失），不做 existsSync 预探测。
 */
export function readPackageJson<T extends PackageJson = PackageJson>(dir: string): T | null {
  const pkgPath = path.join(dir, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
