/**
 * Dashboard 数据类型定义
 *
 * harness 提供数据，studio 负责渲染
 */

import type { KnowledgeType, MaturityLevel } from '../knowledge/types';
import type { ConstraintLayer, DeprecationStatus } from '../constraints/types';

// ── 知识库全景 ───────────────────────────────────────────

export interface KnowledgeOverview {
  byType: Array<{
    type: KnowledgeType;
    total: number;
    proven: number;
    verified: number;
    draft: number;
  }>;
  total: number;
  maturityDistribution: {
    proven: number;
    verified: number;
    draft: number;
    provenPercent: number;
    verifiedPercent: number;
    draftPercent: number;
  };
  decayWarning: {
    provenUnused6m: number;
    verifiedUnused3m: number;
  };
}

// ── 约束执行热力图 ───────────────────────────────────────

export interface ConstraintHeatmap {
  period: string; // e.g. "近 30 天"
  constraints: Array<{
    id: string;
    layer: ConstraintLayer;
    trigger: number;
    pass: number;
    intercept: number;
    interceptRate: number;
    deprecationStatus: DeprecationStatus;
    permanent?: boolean;
  }>;
  neverTriggered: string[];
  decliningInterceptRate: Array<{
    id: string;
    from: number;
    to: number;
  }>;
}

// ── 知识流转路径 ─────────────────────────────────────────

export interface KnowledgeFlow {
  period: string;
  pipeline: {
    extracted: number;
    ingested: number;
    referenced: number;
    upgraded: number;
    downgraded: number;
  };
  transitions: {
    draftToVerified: number;
    verifiedToProven: number;
    provenToVerified: number;
    verifiedToDraft: number;
  };
  topReferenced: Array<{
    id: string;
    title: string;
    referenceCount: number;
  }>;
}

// ── 反馈环状态 ───────────────────────────────────────────

export interface FeedbackLoopStatus {
  local: {
    active: number;
    lastFeedback?: string;
    lastType?: string;
  };
  push: {
    active: number;
    lastFeedback?: string;
    lastType?: string;
  };
  external: {
    active: number;
    lastFeedback?: string;
    lastType?: string;
  };
  feedbackToKnowledge: {
    total: number;
    pending: number;
  };
}

// ── 汇总 ────────────────────────────────────────────────

export interface HarnessDashboardData {
  timestamp: string;
  knowledgeOverview: KnowledgeOverview;
  constraintHeatmap: ConstraintHeatmap;
  knowledgeFlow: KnowledgeFlow;
  feedbackLoop: FeedbackLoopStatus;
}
