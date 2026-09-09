/**
 * PassesGate - 测试门控
 * 
 * 确保 task.passes 字段只能通过测试结果修改
 * 禁止 Agent 自评通过
 *
 * 「过了没」的判定依据不在本文件：唯一入口是 test-output.ts 的 judgeTestRun（ADR-0014）
 */

import { execAsync } from '../../utils/exec';
import { judgeTestRun } from './test-output';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  PassesGateConfig,
  TaskTestResult,
  DynamicTask,
  TestResult,
  PassesGateCheckResult,
  PassesGateViolation,
} from '../../types/passes-gate';


/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<PassesGateConfig> = {
  enabled: true,
  testCommand: '',
  requireEvidence: true,
  allowPartialPass: false,
};

/**
 * 检测项目的测试命令（唯一正本，CLI 与库调用共消费，架构评审 A2）
 *
 * 探测顺序：test:ci → test（排除 npm 默认 echo 占位脚本）→ test:e2e → test:coverage
 * → Python（pyproject.toml 或 pytest.ini 任一）→ go.mod。
 * 探不到返回 undefined，兜底策略归调用方（CLI 映射为 skip；PassesGate 内部 fail-closed）。
 */
export async function detectTestCommand(projectPath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(content);

    if (pkg.scripts?.['test:ci']) {
      return 'npm run test:ci';
    }
    if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified"') {
      return 'npm test';
    }
    if (pkg.scripts?.['test:e2e']) {
      return 'npm run test:e2e';
    }
    if (pkg.scripts?.['test:coverage']) {
      return 'npm run test:coverage';
    }
  } catch {
    // 没有 package.json，继续探测其他项目类型
  }

  // Python 项目：pyproject.toml 或 pytest.ini 任一命中
  for (const marker of ['pyproject.toml', 'pytest.ini']) {
    try {
      await fs.access(path.join(projectPath, marker));
      return 'pytest';
    } catch {}
  }

  // Go 项目
  try {
    await fs.access(path.join(projectPath, 'go.mod'));
    return 'go test ./...';
  } catch {}

  return undefined;
}

/**
 * PassesGate 类
 */
export class PassesGate {
  private config: Required<PassesGateConfig>;

  constructor(config: Partial<PassesGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ========================================
  // AS-006: 纯约束验证接口
  // ========================================

  /**
   * 验证测试结果（不运行测试）
   *
   * 类似 checkConstraints() 的接口风格：
   - harness 只负责验证，不负责执行
   * - 业务层自己运行测试，传入结果
   *
   * @param testResult 测试结果（由业务层运行测试后传入）
   * @returns 验证结果（是否允许标记完成 + Iron Law 违规）
   *
   * @example
   * ```typescript
   * // Studio 调用方式
   * const testResult = await runTestCommand(workDir);  // Studio 自己运行
   * const passesResult = passesGate.check(testResult); // harness 只验证
   *
   * if (!passesResult.allowed) {
   *   return res.status(400).json({
   *     error: 'Iron Law 违规',
   *     violations: passesResult.violations,
   *   });
   * }
   * ```
   */
  check(testResult: TestResult): PassesGateCheckResult {
    const violations: PassesGateViolation[] = [];

    // 1. 测试未通过 → Iron Law #2: NO SELF APPROVAL WITHOUT TEST EVIDENCE
    if (!testResult.passed) {
      violations.push({
        id: 'no_self_approval',
        rule: 'NO SELF APPROVAL WITHOUT TEST EVIDENCE',
        message: '测试未通过',
        level: 'iron_law',
      });
    }

    // 2. 缺少证据 → Iron Law #3: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION
    if (this.config.requireEvidence && !testResult.evidence) {
      violations.push({
        id: 'no_completion_without_verification',
        rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION',
        message: '缺少测试证据',
        level: 'iron_law',
      });
    }

    // 3. 返回结果
    if (violations.length > 0) {
      return {
        allowed: false,
        violations,
        testResult,
      };
    }

    return {
      allowed: true,
      testResult,
    };
  }

  /**
   * 运行测试（CLI 使用）
   *
   * `workDir` 必传：执行位置与证据落盘根都从这里来，不在本层取 cwd
   * （projectPath 只在 CLI 入口兜底一次，见 src/cli/commands/CONTEXT.md）
   */
  async runTests(workDir: string): Promise<{
    passed: boolean;
    passedTests: number;
    failedTests: number;
    totalTests: number;
    duration: number;
    failures?: { name: string; message: string }[];
    message?: string;
  }> {
    const startTime = Date.now();

    try {
      const testCommand = this.config.testCommand || await detectTestCommand(workDir);
      
      if (!testCommand) {
        return {
          passed: false,
          passedTests: 0,
          failedTests: 0,
          totalTests: 0,
          duration: Date.now() - startTime,
          message: '未检测到测试命令',
        };
      }

      const result = await this.runTest(workDir, undefined, testCommand);
      const duration = Date.now() - startTime;

      // 解析测试数量
      const output = result.output || '';
      const passedMatch = output.match(/(\d+) passed/i);
      const failedMatch = output.match(/(\d+) failed/i);
      
      const passedTests = passedMatch?.[1] ? parseInt(passedMatch[1], 10) : (result.passed ? 1 : 0);
      const failedTests = failedMatch?.[1] ? parseInt(failedMatch[1], 10) : (result.passed ? 0 : 1);

      return {
        passed: result.passed,
        passedTests,
        failedTests,
        totalTests: passedTests + failedTests,
        duration,
        failures: result.failures?.map(f => ({ name: f, message: f })),
        message: result.passed ? '测试通过' : '测试失败',
      };
    } catch (error: any) {
      return {
        passed: false,
        passedTests: 0,
        failedTests: 1,
        totalTests: 1,
        duration: Date.now() - startTime,
        message: error.message,
      };
    }
  }

  /**
   * 运行测试
   */
  private async runTest(workDir: string, _task?: DynamicTask, command?: string): Promise<TaskTestResult> {
    const testCommand = command || this.config.testCommand || await detectTestCommand(workDir);
    const timestamp = new Date();

    // 探测失败 fail-closed：与 runTests 的「未检测到测试命令」分支同形状
    if (!testCommand) {
      return {
        passed: false,
        command: '',
        output: '未检测到测试命令',
        timestamp,
      };
    }

    let exitCode = 0;
    let output = '';

    try {
      const result = await execAsync(testCommand, {
        cwd: workDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });
      output = result.stdout + result.stderr;
    } catch (error: any) {
      // 非零退出（超时 / buffer 溢出等执行失败也落这里）：判定依据就是退出码，文本不参与
      exitCode = typeof error.code === 'number' ? error.code : 1;
      output = (error.stdout || '') + '\n' + (error.stderr || '');
    }

    const { passed, failures } = judgeTestRun({
      exitCode,
      output,
      allowPartialPass: this.config.allowPartialPass,
    });

    return {
      passed,
      command: testCommand,
      output,
      failures,
      timestamp,
      evidence: await this.generateEvidence(workDir, output),
    };
  }

  /**
   * 生成测试证据
   */
  private async generateEvidence(workDir: string, output: string): Promise<string> {
    const evidenceDir = path.join(workDir, '.harness', 'evidence');
    await fs.mkdir(evidenceDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const evidenceFile = path.join(evidenceDir, `test-${timestamp}.log`);

    await fs.writeFile(evidenceFile, output);

    return evidenceFile;
  }

  /**
   * 验证证据存在
   */
  private async verifyEvidence(evidencePath: string, workDir: string): Promise<boolean> {
    try {
      const fullPath = path.isAbsolute(evidencePath)
        ? evidencePath
        : path.join(workDir, evidencePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

}

/**
 * 创建 PassesGate 实例
 */
export function createPassesGate(config?: Partial<PassesGateConfig>): PassesGate {
  return new PassesGate(config);
}
