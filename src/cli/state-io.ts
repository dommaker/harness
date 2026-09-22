/**
 * 状态文件 IO 接缝（StateIO，ADR-0026 / harness#148）
 *
 * `.harness/.state.json` 是 harness **自身**的运行期状态（与 RunEnv 观察的项目上行
 * 数据不是一类东西，RunEnv 保持 ADR-0023 的只读契约）。本模块是它读-改-写的唯一
 * 入口：`check` 的智能提示、`status` 与 `constraints report`/`retire` 的观察名单
 * （块 3 子项 4）都经本接缝，命令函数以可选参数注入，
 * 缺省 = 真实 fs 实现（照 `CommandIO` 的注入模式，但不扩 `CommandIO`——输出面与
 * 状态面是两个概念）。
 *
 * 落点 cli 层：两个消费者都在 cli，不进 core、不进包根导出面（零公共面变化）。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConstraintWatchlistState } from '../core/constraints/usage-report';

/**
 * `.harness/.state.json` 的具名类型（从 check.ts 内联类型提出，ADR-0026 决策 1）。
 * `lastDiagnoseRun` 字段已删除——全仓零生产者零消费者（ADR-0022 口径）；
 * 已落盘旧文件里残留该键无害，不做迁移。
 */
export interface HarnessState {
  /** 已展示过的智能提示 id（去重依据） */
  shownHints?: string[];
  /** 最近一次 `harness status` 运行时刻（ISO 串） */
  lastStatusRun?: string;
  /**
   * 零拦截观察名单（ADR-0032，块 3 子项 4）：constraintId → 列入时刻。
   * `constraints report` / `constraints retire` 经本接缝读-改-写（只增不删）。
   */
  constraintWatchlist?: ConstraintWatchlistState;
}

/** harness 自身运行期状态文件的可注入接缝（读-改-写的唯一入口） */
export interface StateIO {
  /** 文件缺失/空 → `{}`；损坏 → 现状语义（JSON.parse 抛即抛，不兜底，ADR-0026 决策 4） */
  read(): HarnessState;
  write(state: HarnessState): void;
}

/**
 * 缺省真实 fs 实现：锚 projectPath（与 trace 落点同锚，#139），
 * 状态文件路径知识只在本模块一份。
 */
export function fileStateIO(projectPath: string): StateIO {
  const statePath = path.join(projectPath, '.harness', '.state.json');
  return {
    read(): HarnessState {
      if (!fs.existsSync(statePath)) return {};
      const content = fs.readFileSync(statePath, 'utf-8');
      if (content.trim() === '') return {};
      return JSON.parse(content);
    },
    write(state: HarnessState): void {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    },
  };
}
