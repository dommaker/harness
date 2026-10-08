/**
 * 知识库路径解析与 store 构造（ADR-0040 Phase 3 自 knowledge-view.ts 拆出）
 *
 * 与 view（投影出口）无关：constraints-retire/reactivate 的知识沉淀写口接线
 * 也消费这里。`-p` / `KNOWLEDGE_BASE_DIR` / 缺省目录解析只在这一处
 * （ADR-0034：消费方数据区正本由编排侧经 KNOWLEDGE_BASE_DIR 显式注入）。
 */

import * as os from 'os';
import * as path from 'path';
import { FileKnowledgeStore } from '../../../knowledge/store';
import type { CommandIO } from '../../command-contract';

/** 缺省知识库数据根（相对用户 home）。裸 CLI 项目缺省目录；消费方数据区正本由编排侧经 KNOWLEDGE_BASE_DIR 显式注入（ADR-0034） */
const KNOWLEDGE_DATA_DIR = path.join('.harness', 'knowledge');

export interface KnowledgePathOptions {
  /** 覆盖知识库目录（audit/snapshot/migrate/index/health 收） */
  dir?: string;
  /** -p/--project-path */
  projectPath?: string;
}

/**
 * 知识库数据根的唯一解析点。`-p` 优先，其次 KNOWLEDGE_BASE_DIR，
 * 最后落到用户 home 缺省目录（ADR-0034 目录收编：消费方数据区正本由
 * 编排侧经 KNOWLEDGE_BASE_DIR 显式注入，本命令不做任何旧目录兼容沿用；
 * io 参数随兼容提示一并失去用途，签名保留免动全部调用方）。
 */
export function resolveKnowledgeBaseDir(options: KnowledgePathOptions, _io: CommandIO): string {
  if (options.dir) return options.dir;
  if (options.projectPath) return `${options.projectPath}/.harness/knowledge`;
  if (process.env.KNOWLEDGE_BASE_DIR) return process.env.KNOWLEDGE_BASE_DIR;
  return path.join(os.homedir(), KNOWLEDGE_DATA_DIR);
}

/** 知识库句柄的唯一构造点（路径解析全权交给 resolveKnowledgeBaseDir） */
export function openKnowledgeStore(options: KnowledgePathOptions, io: CommandIO): FileKnowledgeStore {
  return new FileKnowledgeStore({ baseDir: resolveKnowledgeBaseDir(options, io) });
}
