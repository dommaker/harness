#!/usr/bin/env node
/**
 * 示例业务检查器（harness#181 验收示例）：public-repo-sanitization
 *
 * 场景原型 = studio 侧安全底线 public_repo_sanitization（ADR-0032 ①）：公开发布仓的
 * 受跟踪文本不得残留开发机现场绝对路径（/Users/<name>/、/home/<name>/），文档示例的
 * 占位符形态（/Users/<you>/ 等尖括号段）豁免。
 *
 * 模板填不了的点：命中判定带豁免谓词，regex-scan「命中即违规」表达不了——正是
 * ADR-0035 决策 3 的 exec 档场景。
 *
 * 协议（与 exec 模板约定）：argv = 待扫文件（相对项目根；exec 模板以项目根为 cwd 执行）；
 * 命中逐条打印到 stdout 并 exit 1；干净 exit 0。业务知识不出业务仓：本脚本即业务判定本体。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MACHINE_PATH = /\/(?:Users|home)\/([^/\s'"]+)\//g;

const hits = [];
for (const rel of process.argv.slice(2)) {
  let content;
  try {
    content = readFileSync(join(process.cwd(), rel), 'utf-8');
  } catch {
    continue; // 文件不可读（已删除/二进制）→ 跳过
  }
  content.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(MACHINE_PATH)) {
      if (m[1].startsWith('<')) continue; // 占位符豁免：/Users/<you>/
      hits.push(`${rel}:${i + 1} 残留开发机现场路径 ${m[0]}`);
    }
  });
}

if (hits.length > 0) {
  for (const hit of hits) console.log(hit);
  process.exit(1);
}
