/**
 * tasks.yml 解析与校验（自 acceptance.ts 拆出，重构班次 3 Phase 4）
 *
 * 只认新契约 `acceptance`（旧的逐条勾选格式已随 gates 层现代化删除，不再兼容）。
 * fail-fast：解析失败 / 形状非法直接抛错，不存在「解析失败当通过/当跳过」的兜底分支。
 */

import { isRecord } from '../utils/guards';

/**
 * 验收条件（唯一契约，支持 E2E 测试关联）
 */
export interface AcceptanceCondition {
  description: string;
  e2e_test?: string;
  test_name?: string;
  checked?: boolean;
}

/**
 * 任务定义
 */
export interface TaskDefinition {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  /** 验收条件（支持 E2E 测试） */
  acceptance?: AcceptanceCondition[];
  status?: string;
  completed?: boolean;
}

/**
 * Tasks 文件结构
 */
export interface TasksFile {
  tasks: TaskDefinition[];
  version?: string;
}

/**
 * yaml.load 结果 → TasksFile：形状非法即抛错（fail-fast，不静默兜底）。
 * 校验只到判定实际读取的字段：tasks 数组、任务 id、acceptance 条目的
 * description / e2e_test / test_name / checked。
 */
export function parseTasksFile(raw: unknown, tasksPath: string): TasksFile {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) {
    throw new Error(`tasks.yml 格式非法（缺 tasks 数组）: ${tasksPath}`);
  }

  const tasks: TaskDefinition[] = raw.tasks.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`tasks.yml 格式非法（tasks[${index}] 缺 id）: ${tasksPath}`);
    }

    let acceptance: AcceptanceCondition[] | undefined;
    if (entry.acceptance !== undefined) {
      if (!Array.isArray(entry.acceptance)) {
        throw new Error(`tasks.yml 格式非法（任务 ${entry.id} 的 acceptance 不是数组）: ${tasksPath}`);
      }
      acceptance = entry.acceptance.map((c: unknown, ci: number) => {
        if (!isRecord(c) || typeof c.description !== 'string') {
          throw new Error(
            `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}] 缺 description）: ${tasksPath}`
          );
        }
        for (const key of ['e2e_test', 'test_name'] as const) {
          if (c[key] !== undefined && typeof c[key] !== 'string') {
            throw new Error(
              `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}].${key} 不是字符串）: ${tasksPath}`
            );
          }
        }
        if (c.checked !== undefined && typeof c.checked !== 'boolean') {
          throw new Error(
            `tasks.yml 格式非法（任务 ${entry.id} 的 acceptance[${ci}].checked 不是布尔）: ${tasksPath}`
          );
        }
        return {
          description: c.description,
          e2e_test: c.e2e_test as string | undefined,
          test_name: c.test_name as string | undefined,
          checked: c.checked as boolean | undefined,
        };
      });
    }

    return {
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title : undefined,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      acceptance,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      completed: typeof entry.completed === 'boolean' ? entry.completed : undefined,
    };
  });

  return {
    tasks,
    version: typeof raw.version === 'string' ? raw.version : undefined,
  };
}
