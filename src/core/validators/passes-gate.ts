/**
 * PassesGate - 测试门控
 * 
 * 确保 task.passes 字段只能通过测试结果修改
 * 禁止 Agent 自评通过
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  PassesGateConfig,
  PassesGateResult,
  TaskTestResult,
  DynamicTask,
  PassesGateExtension,
  ExtensionTestResult,
  TestResult,
  PassesGateCheckResult,
  PassesGateViolation,
} from '../../types/passes-gate';

const execAsync = promisify(exec);

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<PassesGateConfig> = {
  enabled: true,
  testCommand: '',
  requireEvidence: true,
  allowPartialPass: false,
  maxRetries: 2,
  retryDelay: 1000,
};

/**
 * 测试文件保护模式
 */
const PROTECTED_TEST_PATTERNS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/tests/**',
  '**/__tests__/**',
];

/**
 * PassesGate 类
 */
export class PassesGate {
  private config: Required<PassesGateConfig>;
  private testResults: Map<string, TaskTestResult> = new Map();

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
   * 设置任务通过状态
   * 核心方法：强制测试验证
   */
  async setPasses(
    taskId: string,
    value: boolean,
    workDir: string,
    task?: DynamicTask
  ): Promise<PassesGateResult> {
    if (!this.config.enabled) {
      return {
        taskId,
        allowed: true,
        attempts: 0,
      };
    }

    // 如果设置为 false，直接允许
    if (value === false) {
      return {
        taskId,
        allowed: true,
        testResult: {
          passed: false,
          command: 'manual',
          timestamp: new Date(),
        },
        attempts: 0,
      };
    }

    // 如果设置为 true，必须运行测试
    let attempts = 0;
    let lastError: string | undefined;
    let testResult: TaskTestResult | undefined;

    while (attempts <= this.config.maxRetries) {
      attempts++;
      
      try {
        testResult = await this.runTest(workDir, task);
        
        if (testResult.passed) {
          // 记录测试结果
          this.testResults.set(taskId, testResult);
          
          // 如果要求证据，验证证据存在
          if (this.config.requireEvidence && testResult.evidence) {
            const evidenceExists = await this.verifyEvidence(testResult.evidence, workDir);
            if (!evidenceExists) {
              return {
                taskId,
                allowed: false,
                error: 'Test evidence not found',
                testResult,
                attempts,
              };
            }
          }
          
          return {
            taskId,
            allowed: true,
            testResult,
            attempts,
          };
        }
        
        lastError = `Tests failed: ${testResult.failures?.join(', ') || 'Unknown error'}`;
        
        // 等待后重试
        if (attempts <= this.config.maxRetries) {
          await this.delay(this.config.retryDelay);
        }
      } catch (error: any) {
        lastError = error.message;
        
        if (attempts <= this.config.maxRetries) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    return {
      taskId,
      allowed: false,
      error: lastError,
      testResult,
      attempts,
    };
  }

  /**
   * 运行测试（CLI 使用）
   */
  async runTests(): Promise<{
    passed: boolean;
    passedTests: number;
    failedTests: number;
    totalTests: number;
    duration: number;
    failures?: { name: string; message: string }[];
    message?: string;
  }> {
    const startTime = Date.now();
    const workDir = process.cwd();
    
    try {
      const testCommand = this.config.testCommand || await this.detectTestCommand(workDir);
      
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

      const result = await this.runTest(workDir);
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
  private async runTest(workDir: string, task?: DynamicTask): Promise<TaskTestResult> {
    const testCommand = await this.detectTestCommand(workDir);
    const timestamp = new Date();

    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: workDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const passed = true;
      const coverage = this.extractCoverage(stdout);
      const failures: string[] = [];

      return {
        passed,
        command: testCommand,
        output: stdout,
        failures,
        coverage,
        timestamp,
        evidence: await this.generateEvidence(workDir, stdout),
      };
    } catch (error: any) {
      const output = error.stdout || '';
      const stderrOutput = error.stderr || '';
      const combinedOutput = output + '\n' + stderrOutput;

      const failures = this.extractFailures(combinedOutput);
      const passed = this.config.allowPartialPass && failures.length === 0;

      return {
        passed,
        command: testCommand,
        output: combinedOutput,
        failures,
        coverage: this.extractCoverage(output),
        timestamp,
        evidence: await this.generateEvidence(workDir, combinedOutput),
      };
    }
  }

  /**
   * 检测测试命令
   */
  private async detectTestCommand(workDir: string): Promise<string> {
    if (this.config.testCommand) {
      return this.config.testCommand;
    }

    // 尝试读取 package.json
    try {
      const packageJsonPath = path.join(workDir, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);

      // 优先使用 e2e 测试
      if (packageJson.scripts?.['test:e2e']) {
        return 'npm run test:e2e';
      }
      if (packageJson.scripts?.['test:coverage']) {
        return 'npm run test:coverage';
      }
      if (packageJson.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // package.json 不存在，尝试其他检测
    }

    // 尝试 Python 项目
    try {
      const pyprojectPath = path.join(workDir, 'pyproject.toml');
      await fs.access(pyprojectPath);
      return 'pytest';
    } catch {
      // 不是 Python 项目
    }

    // 尝试 Go 项目
    try {
      const goModPath = path.join(workDir, 'go.mod');
      await fs.access(goModPath);
      return 'go test ./...';
    } catch {
      // 不是 Go 项目
    }

    // 默认命令
    return 'npm test';
  }

  /**
   * 从输出中提取覆盖率
   */
  private extractCoverage(output: string): number | undefined {
    // Jest 格式: All files | 80.5 | 70.2 | ...
    const jestMatch = output.match(/All files[|\s]+(\d+\.?\d*)/);
    if (jestMatch?.[1]) {
      return parseFloat(jestMatch[1]);
    }

    // Istanbul/nyc 格式: Statements   : 80.5% ( 100/124 )
    const istanbulMatch = output.match(/Statements\s*:\s*(\d+\.?\d*)%/);
    if (istanbulMatch?.[1]) {
      return parseFloat(istanbulMatch[1]);
    }

    // pytest-cov 格式: TOTAL  1234  80%
    const pytestMatch = output.match(/TOTAL\s+\d+\s+(\d+)%/);
    if (pytestMatch?.[1]) {
      return parseInt(pytestMatch[1], 10);
    }

    return undefined;
  }

  /**
   * 从输出中提取失败信息
   */
  private extractFailures(output: string): string[] {
    const failures: string[] = [];

    // Jest 格式
    const jestMatches = output.matchAll(/✕\s+(.+?)\s+\(/g);
    for (const match of jestMatches) {
      if (match[1]) failures.push(match[1]);
    }

    // Mocha 格式
    const mochaMatches = output.matchAll(/\d+\)\s+(.+?):/g);
    for (const match of mochaMatches) {
      if (match[1]) failures.push(match[1]);
    }

    // pytest 格式
    const pytestMatches = output.matchAll(/FAILED\s+(.+?)::/g);
    for (const match of pytestMatches) {
      if (match[1]) failures.push(match[1]);
    }

    // Go test 格式
    const goMatches = output.matchAll(/--- FAIL:\s+(.+?)\s+\(/g);
    for (const match of goMatches) {
      if (match[1]) failures.push(match[1]);
    }

    return failures;
  }

  /**
   * 生成测试证据
   */
  private async generateEvidence(workDir: string, output: string): Promise<string> {
    const evidenceDir = path.join(workDir, '.agent', 'evidence');
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

  /**
   * 检测是否修改了测试文件
   */
  async checkTestFileChanges(workDir: string): Promise<string[]> {
    const changedTestFiles: string[] = [];

    try {
      const { stdout } = await execAsync('git diff --name-only', { cwd: workDir });
      const changedFiles = stdout.split('\n').filter(Boolean);

      // 简单的模式匹配
      for (const file of changedFiles) {
        const isTestFile = PROTECTED_TEST_PATTERNS.some(() => {
          return file.includes('.test.') ||
                 file.includes('.spec.') ||
                 file.includes('/tests/') ||
                 file.includes('/__tests__/');
        });

        if (isTestFile) {
          changedTestFiles.push(file);
        }
      }
    } catch {
      // Git 不可用，跳过检查
    }

    return changedTestFiles;
  }

  /**
   * 获取任务的测试结果
   */
  getTestResult(taskId: string): TaskTestResult | undefined {
    return this.testResults.get(taskId);
  }

  // ========================================
  // 扩展点支持（Long-Running Agents）
  // ========================================

  /**
   * 注册的扩展列表
   */
  private extensions: Map<string, PassesGateExtension> = new Map();

  /**
   * 注册扩展
   * 
   * 用于注册额外的测试类型（如 Puppeteer E2E）
   * 
   * @param name 扩展名称
   * @param extension 扩展实现
   * 
   * @example
   * ```typescript
   * const puppeteerExtension = {
   *   name: 'puppeteer',
   *   run: async (workDir, task) => {
   *     // 运行 Puppeteer 测试
   *     return { passed: true, command: 'puppeteer', ... };
   *   }
   * };
   * 
   * passesGate.registerExtension('puppeteer', puppeteerExtension);
   * ```
   */
  registerExtension(name: string, extension: PassesGateExtension): void {
    this.extensions.set(name, extension);
  }

  /**
   * 注销扩展
   */
  unregisterExtension(name: string): boolean {
    return this.extensions.delete(name);
  }

  /**
   * 获取所有已注册的扩展名称
   */
  getExtensionNames(): string[] {
    return Array.from(this.extensions.keys());
  }

  /**
   * 运行所有测试（包括扩展测试）
   * 
   * @param workDir 工作目录
   * @param task 可选的任务信息
   * @returns 所有测试结果
   */
  async runAllTests(workDir: string, task?: DynamicTask): Promise<ExtensionTestResult[]> {
    const results: ExtensionTestResult[] = [];

    // 1. 运行单元测试（原有逻辑）
    const unitTestResult = await this.runTest(workDir, task);
    results.push(unitTestResult);

    // 2. 运行所有扩展测试
    for (const [name, extension] of this.extensions) {
      try {
        const extensionResult = await extension.run(workDir, task);
        results.push({
          ...extensionResult,
          type: name,
        });
      } catch (error: any) {
        results.push({
          passed: false,
          command: `${name}-extension`,
          error: error.message,
          type: name,
          timestamp: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * 检查所有测试是否通过
   */
  async checkAllPasses(workDir: string, task?: DynamicTask): Promise<{
    passed: boolean;
    results: ExtensionTestResult[];
    failedTypes: string[];
  }> {
    const results = await this.runAllTests(workDir, task);
    const failedTypes = results
      .filter(r => !r.passed)
      .map(r => r.type || 'unit');

    return {
      passed: failedTypes.length === 0,
      results,
      failedTypes,
    };
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建 PassesGate 实例
 */
export function createPassesGate(config?: Partial<PassesGateConfig>): PassesGate {
  return new PassesGate(config);
}