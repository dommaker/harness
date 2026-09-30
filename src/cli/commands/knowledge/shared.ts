/**
 * knowledge 子命令共享的入参面（Phase 3：原 knowledge.ts 的公共类型，纯移位）
 */

export interface KnowledgeOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

/** 子操作共用的入参面：知识库目录覆盖（audit/snapshot/migrate/index/health 收） */
export type KnowledgeDirOption = { dir?: string };
