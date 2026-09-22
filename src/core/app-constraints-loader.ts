/**
 * 应用层约束加载器（ADR-0033 两层约束模型）
 *
 * 读应用仓 `.harness/constraints.yml` → 校验 → 实例化 `Constraint[]`（source='app'）。
 * 职责切分：config.yml = 对内置/应用层约束的裁剪与墓碑；constraints.yml = 应用层约束的定义正本。
 *
 * 接口规则（调用方须知）：
 * - 文件不存在 = 无应用层约束，正常返回空；文件存在但 YAML 解析失败/缺必填字段 → 抛错
 *   （配置坏不能静默放行，延续注册表闭环语义）
 * - id 强制 `app_` 前缀；与内置 id 冲突或无前缀 → 加载期抛错
 * - checker 必须是模板注册表（checkers/index.ts TEMPLATES）里的 id，且 validateParams 通过，
 *   否则加载期抛错
 * - 必填字段：id / rule / checker / severity；可选：params / trigger / message / description /
 *   enforcement。trigger 缺省 = 每次 check 都评估（全操作集）
 *
 * memo 口径与 `RunEnv.rawConfig()` 同形：传 RunEnv 即一枚观察面至多读一次
 * （WeakMap 挂在实例上）；传项目根路径 = 自造一枚一次性观察面，每次调用读当下内容。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Constraint, ConstraintSeverity, ConstraintTrigger } from '../types/constraint';
import { CONSTRAINTS } from './constraints/definitions';
// 模板注册表直引 templates-registry 而非 checkers 桶：checkers/index.ts 经内置
// checker 回头依赖 project-config-loader，从本模块引桶会成值级循环
import { TEMPLATES } from './constraints/checkers/templates-registry';
import { resolveRunEnv, type RunEnv, type RunTarget } from './constraints/run-env';

/** 应用层约束定义文件在项目根下的相对路径 */
const APP_CONSTRAINTS_FILE_REL = path.join('.harness', 'constraints.yml');

/** id 强制前缀 */
const APP_ID_PREFIX = 'app_';

const SEVERITIES: readonly ConstraintSeverity[] = ['error', 'warning', 'info'];

/**
 * trigger 缺省值 = 全操作集：应用层约束未声明 trigger 时每次 check 都评估
 * （填空式模板多为扫描/存在性形态，与 no_hardcoded_credentials 同类，不猜触发域）
 */
const DEFAULT_TRIGGERS: ConstraintTrigger[] = [
  'code_implementation',
  'test_creation',
  'module_creation',
  'module_modification',
  'module_extension',
  'module_deletion',
  'file_modification',
  'doc_update',
  'config_change',
  'commit',
];

/** run 内 memo（与 RunEnv.rawConfig 同形：一枚观察面至多读一次） */
const memo = new WeakMap<RunEnv, Constraint[]>();

class AppConstraintsError extends Error {}

function fail(rel: string, detail: string): never {
  throw new AppConstraintsError(`[harness] 应用层约束加载失败（${rel}）：${detail}`);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 校验并实例化单条应用层约束条目 */
function toConstraint(raw: unknown, index: number, rel: string): Constraint {
  const at = `constraints[${index}]`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(rel, `${at} 必须是对象`);
  }
  const entry = raw as Record<string, unknown>;

  const id = asString(entry.id);
  if (!id) fail(rel, `${at} 缺必填字段 id`);
  // 冲突判定在前：撞上内置 id 的条目报"冲突"比报"缺前缀"更指向根因
  if (CONSTRAINTS[id]) {
    fail(rel, `${at} id "${id}" 与内置约束冲突`);
  }
  if (!id.startsWith(APP_ID_PREFIX)) {
    fail(rel, `${at} id "${id}" 必须有 ${APP_ID_PREFIX} 前缀（应用层约束命名空间）`);
  }

  const rule = asString(entry.rule);
  if (!rule) fail(rel, `${at} (${id}) 缺必填字段 rule`);

  const checker = asString(entry.checker);
  if (!checker) fail(rel, `${at} (${id}) 缺必填字段 checker`);
  const factory = TEMPLATES.get(checker);
  if (!factory) {
    fail(rel, `${at} (${id}) 引用的 checker 模板 "${checker}" 未注册（可用模板见 checkers/templated/）`);
  }

  const severity = entry.severity;
  if (!SEVERITIES.includes(severity as ConstraintSeverity)) {
    fail(rel, `${at} (${id}) 缺必填字段 severity 或取值非法（须为 ${SEVERITIES.join('/')}）`);
  }

  const params = entry.params;
  if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
    fail(rel, `${at} (${id}) params 必须是对象`);
  }
  const paramErrors = factory.validateParams((params ?? {}) as Record<string, unknown>);
  if (paramErrors.length > 0) {
    fail(rel, `${at} (${id}) 模板 "${checker}" 参数校验失败：${paramErrors.join('；')}`);
  }

  const trigger = entry.trigger;
  if (trigger !== undefined && typeof trigger !== 'string' &&
    !(Array.isArray(trigger) && trigger.every(t => typeof t === 'string'))) {
    fail(rel, `${at} (${id}) trigger 必须是字符串或字符串数组`);
  }

  return {
    id,
    kind: 'check',
    rule,
    message: asString(entry.message) ?? rule,
    severity: severity as ConstraintSeverity,
    trigger: (trigger as ConstraintTrigger | ConstraintTrigger[] | undefined) ?? DEFAULT_TRIGGERS,
    enforcement: asString(entry.enforcement) ?? '',
    description: asString(entry.description),
    source: 'app',
    checker,
    params: params as Record<string, unknown> | undefined,
  };
}

/**
 * 读取并实例化应用层约束（`.harness/constraints.yml`）
 *
 * @param target 项目根路径，或本 run 已构造的运行级观察面（与 rawConfig 同一入参形状）；
 *   传观察面 = 与本 run 其余消费方共用「一次运行至多读一次」语义
 */
export function loadAppConstraints(target: RunTarget): Constraint[] {
  const env = resolveRunEnv(target);
  const cached = memo.get(env);
  if (cached) return cached;

  const rel = APP_CONSTRAINTS_FILE_REL;
  const file = path.join(env.projectPath, rel);
  let constraints: Constraint[] = [];
  if (fs.existsSync(file)) {
    let loaded: unknown;
    try {
      loaded = yaml.load(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      fail(rel, `YAML 解析失败：${err instanceof Error ? err.message : String(err)}`);
    }
    const root = (loaded ?? {}) as unknown;
    if (root === null || typeof root !== 'object' || Array.isArray(root)) {
      fail(rel, '顶层必须是对象（含 constraints 列表）');
    }
    const list = (root as Record<string, unknown>).constraints;
    if (list !== undefined && !Array.isArray(list)) {
      fail(rel, 'constraints 必须是数组');
    }
    constraints = (list ?? []).map((entry, i) => toConstraint(entry, i, rel));
  }

  memo.set(env, constraints);
  return constraints;
}
