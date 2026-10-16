/**
 * 检查点验证引擎（查落实工具，ADR-0036；原「编排层」自述为项目初期历史话术，
 * 与 ADR-0031「harness 不做生产编排」冲突，已废止）
 *
 * 执行项目自声明的检查点（13 种通用 check type，见 .harness/checkpoints.yml）；
 * 消费方：harness validate CLI、CI、下游运行时。
 * 各检查族实现位于 check-handlers/{file,command,output,http}.ts。
 */

import type {
  Checkpoint,
  CheckpointCheck,
  CheckpointResult,
  CheckResult,
  CheckpointContext,
  CheckType,
  CustomCheck,
} from '../../types/checkpoint';
import {
  checkFileExists,
  checkFileNotEmpty,
  checkFileContains,
  checkFileNotContains,
} from './check-handlers/file';
import { checkCommandSuccess, checkCommandOutput } from './check-handlers/command';
import {
  checkOutputContains,
  checkOutputNotContains,
  checkOutputMatches,
  checkJsonPath,
} from './check-handlers/output';
import { checkHttpStatus, checkHttpBody } from './check-handlers/http';
import { errorMessage } from '../../utils/error';
import { isRecord } from '../../utils/guards';

/**
 * 各 CheckType 的 config 必填字段（判别联合的运行时校验表，
 * 与 types/checkpoint.ts 的联合成员一一对应——新增 type 两处同步）
 */
const REQUIRED_CONFIG_FIELDS: Record<CheckType, readonly string[]> = {
  file_exists: ['path'],
  file_not_empty: ['path'],
  file_contains: ['path', 'content'],
  file_not_contains: ['path', 'content'],
  command_success: ['command'],
  command_output: ['command', 'expected'],
  output_contains: [],
  output_not_contains: [],
  output_matches: ['pattern'],
  json_path: ['jsonPath'],
  http_status: ['url'],
  http_body: ['url', 'expected'],
  custom: ['customFunction'],
};

/**
 * checkpoints.yml 解析结果的形状校验（fail-fast，重构班次 3 Phase 5）：
 * 每条 check 按 type 校验 config 必填字段——缺字段/空串/非字符串即抛错
 * 指名字段（不做 `as Checkpoint[]` 强转蒙混：配置损坏在加载期暴露，
 * 不流到 handler 才被假值兜底吞掉）。
 */
export function assertCheckpointShape(data: unknown, source: string): asserts data is Checkpoint[] {
  if (!Array.isArray(data)) {
    throw new Error(`checkpoints 形状非法（顶层不是数组）: ${source}`);
  }
  for (const cp of data) {
    if (!isRecord(cp) || typeof cp.id !== 'string' || !Array.isArray(cp.checks)) {
      throw new Error(`checkpoints 形状非法（checkpoint 缺 id 或 checks 数组）: ${source}`);
    }
    for (const check of cp.checks) {
      if (!isRecord(check) || typeof check.id !== 'string' || typeof check.type !== 'string') {
        throw new Error(`checkpoints 形状非法（check 缺 id 或 type）: ${source}`);
      }
      const required = REQUIRED_CONFIG_FIELDS[check.type as CheckType];
      if (!required) {
        throw new Error(`checkpoints 检查 ${check.id} 未知检查类型: ${check.type}（${source}）`);
      }
      if (!isRecord(check.config)) {
        throw new Error(`checkpoints 检查 ${check.id}（${check.type}）缺 config 对象（${source}）`);
      }
      for (const field of required) {
        const value = check.config[field];
        if (value === undefined || value === '') {
          throw new Error(`checkpoints 检查 ${check.id}（${check.type}）缺少必填 config 字段: ${field}（${source}）`);
        }
      }
    }
  }
}

/**
 * 检查点验证器（无状态，构造器直建——单例壳已随 ADR-0040 Phase 4 删除）
 */
export class CheckpointValidator {
  /**
   * 验证检查点
   */
  async validate(checkpoint: Checkpoint, context: CheckpointContext): Promise<CheckpointResult> {
    if (!checkpoint.checks || checkpoint.checks.length === 0) {
      return {
        checkpointId: checkpoint.id,
        passed: true,
        checks: [],
        message: '无检查点要求',
        validatedAt: new Date(),
      };
    }

    const results: CheckResult[] = [];

    for (const check of checkpoint.checks) {
      const result = await this.executeCheck(check, context);
      results.push(result);
    }

    const allPassed = results.every(r => r.passed);

    return {
      checkpointId: checkpoint.id,
      passed: allPassed,
      checks: results,
      message: allPassed ? '检查点验证通过' : '检查点验证失败',
      validatedAt: new Date(),
    };
  }

  /**
   * 执行单个检查项（分发至 check-handlers/ 各族）
   *
   * 无外层 try/catch：13 个 handler 与 custom 分支各自把执行错误译成 CheckResult
   * （错误文本即诊断），外层再兜是对不可能状态的二次防御。
   */
  private async executeCheck(check: CheckpointCheck, context: CheckpointContext): Promise<CheckResult> {
    switch (check.type) {
      case 'file_exists':
        return await checkFileExists(check, context);
      case 'file_not_empty':
        return await checkFileNotEmpty(check, context);
      case 'file_contains':
        return await checkFileContains(check, context);
      case 'file_not_contains':
        return await checkFileNotContains(check, context);
      case 'command_success':
        return await checkCommandSuccess(check, context);
      case 'command_output':
        return await checkCommandOutput(check, context);
      case 'output_contains':
        return await checkOutputContains(check, context);
      case 'output_not_contains':
        return await checkOutputNotContains(check, context);
      case 'output_matches':
        return await checkOutputMatches(check, context);
      case 'json_path':
        return await checkJsonPath(check, context);
      case 'http_status':
        return await checkHttpStatus(check, context);
      case 'http_body':
        return await checkHttpBody(check, context);
      case 'custom':
        return await this.checkCustom(check, context);
      default: {
        // 判别联合在 TS 层已穷尽（default 收窄为 never）；checkpoints.yml 的未知类型
        // 由加载期 assertCheckpointShape 拦截，本分支只兜绕过校验的直构造调用方
        const unknown = check as { id: string; type: string };
        return {
          checkId: unknown.id,
          passed: false,
          message: `未知检查类型: ${unknown.type}`,
          error: `Unknown check type: ${unknown.type}`,
        };
      }
    }
  }

  /**
   * 自定义检查
   */
  private async checkCustom(check: CustomCheck, context: CheckpointContext): Promise<CheckResult> {
    // 检查是否有自定义处理器
    const handler = context.customHandlers?.get(check.config.customFunction);

    if (handler) {
      // 用户注入的 handler 是唯一不受本仓控制的分支：抛错译成 CheckResult（与其余 13 族同口径）
      try {
        return await handler(check.config);
      } catch (error) {
        const detail = errorMessage(error);
        return {
          checkId: check.id,
          passed: false,
          message: `自定义检查执行失败: ${check.config.customFunction}`,
          error: detail,
        };
      }
    }

    return {
      checkId: check.id,
      passed: false,
      message: `自定义检查未实现: ${check.config.customFunction}`,
      error: 'Custom check not implemented',
    };
  }
}
