/**
 * YAML 配置文件条目编辑（cli 层共享模块，自 constraints-retire 抽出）
 *
 * config.yml 类 YAML 的读-改-写单点（harness#137）。
 * js-yaml 不保留注释：原文件含注释行时重写会丢失，console 说明（`label` 是给用户看的
 * 文件名）。落盘字节由 `commands/__tests__/constraints-retire.test.ts`
 * 的逐字节冻结用例钉住——对外产物不得漂移。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';

/**
 * YAML 条目的读-改-写单点（harness#137）
 *
 * js-yaml 不保留注释：原文件含注释行时重写会丢失，console 说明（`label` 是给用户看的
 * 文件名）。落盘字节由 `commands/__tests__/constraints-retire.test.ts`
 * 的逐字节冻结用例钉住——合并属内部重构，对外产物不得漂移。
 *
 * constraints-disable 复用（裸禁用写 `{ enabled: false }` 同一读-改-写口径）。
 */
export function setYamlEntry(
  filePath: string,
  label: string,
  section: string,
  id: string,
  patch: Record<string, unknown>
): void {
  let raw: Record<string, unknown> = {};
  let hadComments = false;
  if (fs.existsSync(filePath)) {
    const original = fs.readFileSync(filePath, 'utf-8');
    hadComments = original.split('\n').some(l => l.trimStart().startsWith('#'));
    raw = (yaml.load(original) as Record<string, unknown>) ?? {};
  }

  const entries = (raw[section] ?? {}) as Record<string, unknown>;
  const prev = (entries[id] ?? {}) as Record<string, unknown>;
  entries[id] = { ...prev, ...patch };
  raw[section] = entries;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');

  if (hadComments) {
    console.log(chalk.yellow(`   ⚠️  ${label} 已重写：js-yaml 不保留原文件注释`));
  }
}

/**
 * YAML 条目的删除单点（constraints reactivate 用，与 setYamlEntry 同一读-改-写口径）
 *
 * 删除 config.yml `section.id` 整个 key；段/条目不存在时零写盘。返回是否实际删除。
 */
export function removeYamlEntry(filePath: string, section: string, id: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const raw = (yaml.load(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>) ?? {};
  const entries = (raw[section] ?? {}) as Record<string, unknown>;
  if (!(id in entries)) return false;
  delete entries[id];
  raw[section] = entries;
  fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: 120 }), 'utf-8');
  return true;
}
