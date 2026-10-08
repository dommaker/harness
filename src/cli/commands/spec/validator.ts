/**
 * Spec 验证器（ADR-0040 Phase 4 自 core/spec 迁入 cli spec 域：唯一消费方是
 * `spec` CLI 命令，类壳是采集+IO 形态，非纯判定）
 *
 * 框架提供验证机制，项目定义自己的 Spec Schema
 *
 * 设计原则：
 * - 框架不包含具体 Schema 定义
 * - 动态加载项目的 Schema
 * - 支持 Zod / JSON Schema / 自定义验证器
 *
 * schemaPath 锚定（#95 同型病灶修复）：`validateAll(projectPath)` 的 schema 与
 * spec 文件同锚 projectPath，不再按 process.cwd() 找；`validateFile` 无根形参，
 * 相对 schemaPath 由调用方在构造时锚好（CLI 组合根恒传绝对路径）。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as glob from 'fast-glob';
import * as yaml from 'js-yaml';
import { createGitEvidence, splitFileNames, type GitCommandRunner } from '../../../core/constraints/git-evidence';
import type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
  SpecValidationError,
} from '../../../types/spec';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SpecValidatorConfig = {
  schemaPath: './specs/schemas',
  files: ['ARCHITECTURE.md', 'specs/**/*.yml', 'specs/**/*.yaml'],
};

/**
 * 动态导入的 Schema 模块形状守卫：只认「带 validate 函数的对象」，
 * name/version 是否合法字符串由调用点各自窄化（坏形状按「无 Schema」处理，不 any 穿透）
 */
function isSchemaModule(m: unknown): m is { name?: unknown; version?: unknown; validate: SpecSchemaDefinition['validate'] } {
  return (
    typeof m === 'object' &&
    m !== null &&
    'validate' in m &&
    typeof (m as { validate?: unknown }).validate === 'function'
  );
}

/**
 * Spec 验证器（构造器直建——getInstance/setConfig 全局可变状态已随 ADR-0040 Phase 4 删除）
 */
export class SpecValidator {
  private config: SpecValidatorConfig;
  private schemaCache: Map<string, SpecSchemaDefinition> = new Map();

  constructor(config?: Partial<SpecValidatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 加载项目的 Schema
   * 
   * 支持两种方式：
   * 1. 指定 schemaPath 目录，自动加载 index.ts/js
   * 2. 使用 --schema 参数指定路径
   */
  async loadSchema(schemaPath: string): Promise<SpecSchemaDefinition | null> {
    const cached = this.schemaCache.get(schemaPath);
    if (cached) return cached;

    const absolutePath = path.resolve(schemaPath);

    // 无自定义 Schema 是正常情况（三个候选都不在场 → null）；
    // 候选在场但加载/解析失败 → 抛出（fail-fast：坏 Schema 不装成「没有 Schema」）
    const indexPath = path.join(absolutePath, 'index.ts');
    const indexPathJs = path.join(absolutePath, 'index.js');

    let schemaModule: unknown;

    if (await this.fileExists(indexPath)) {
      // 动态导入 TypeScript 模块（需要 tsx 或编译后的 .js）
      schemaModule = await this.dynamicImport(indexPath);
    } else if (await this.fileExists(indexPathJs)) {
      schemaModule = await this.dynamicImport(indexPathJs);
    } else if (await this.fileExists(absolutePath)) {
      // 尝试直接加载指定文件
      schemaModule = await this.dynamicImport(absolutePath);
    } else {
      return null;
    }

    if (isSchemaModule(schemaModule)) {
      const schema: SpecSchemaDefinition = {
        name: typeof schemaModule.name === 'string' ? schemaModule.name : 'custom',
        version: typeof schemaModule.version === 'string' ? schemaModule.version : undefined,
        validate: schemaModule.validate,
      };
      this.schemaCache.set(schemaPath, schema);
      return schema;
    }

    return null;
  }

  /**
   * 检测 Spec 类型
   */
  detectSpecType(filePath: string): SpecType {
    const basename = path.basename(filePath).toLowerCase();
    
    if (basename === 'architecture.md') {
      return 'architecture';
    }
    
    if (filePath.includes('module') || filePath.includes('modules')) {
      return 'module';
    }
    
    if (filePath.includes('api') || filePath.includes('apis')) {
      return 'api';
    }
    
    return 'custom';
  }

  /**
   * 验证单个文件
   */
  async validateFile(
    filePath: string,
    schema?: SpecSchemaDefinition
  ): Promise<SpecValidationResult> {
    const specType = this.detectSpecType(filePath);
    const absolutePath = path.resolve(filePath);

    // 检查文件是否存在
    if (!(await this.fileExists(absolutePath))) {
      return {
        valid: false,
        file: filePath,
        type: specType,
        errors: [{ path: '', message: `文件不存在: ${filePath}`, severity: 'error' }],
        warnings: [],
      };
    }

    // 如果没有传入 Schema，尝试加载项目的 Schema
    let schemaToUse = schema;
    if (!schemaToUse) {
      const loadedSchema = await this.loadSchema(this.config.schemaPath);
      schemaToUse = loadedSchema ?? undefined;
    }

    // 如果没有 Schema，使用基础验证
    if (!schemaToUse) {
      return this.basicValidation(filePath, specType);
    }

    // 使用项目的 Schema 验证
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const result = await schemaToUse.validate(content, filePath);
      return result;
    } catch (error) {
      return {
        valid: false,
        file: filePath,
        type: specType,
        errors: [{
          path: '',
          message: `验证失败: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error',
        }],
        warnings: [],
      };
    }
  }

  /**
   * 基础验证（无 Schema 时）
   */
  private async basicValidation(filePath: string, specType: SpecType): Promise<SpecValidationResult> {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const errors: SpecValidationError[] = [];
    const warnings: SpecValidationError[] = [];

    // ARCHITECTURE.md 基础检查
    if (specType === 'architecture') {
      if (!content.includes('# ') && !content.includes('## ')) {
        errors.push({
          path: '',
          message: 'ARCHITECTURE.md 应包含标题和章节',
          severity: 'warning' as const,
        });
      }
    }

    // YAML 文件基础检查
    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      try {
        yaml.load(content);
      } catch (e) {
        errors.push({
          path: '',
          message: `YAML 解析失败: ${e instanceof Error ? e.message : String(e)}`,
          severity: 'error' as const,
        });
      }
    }

    return {
      valid: errors.length === 0,
      file: filePath,
      type: specType,
      errors,
      warnings,
    };
  }

  /**
   * 批量验证
   */
  async validateAll(
    projectPath?: string,
    staged?: boolean
  ): Promise<BatchSpecValidationResult> {
    const cwd = projectPath || process.cwd();
    const results: SpecValidationResult[] = [];

    // 加载项目的 Schema（与 spec 文件同锚 projectPath，不按进程 cwd 找）
    const loadedSchema = await this.loadSchema(path.resolve(cwd, this.config.schemaPath));
    const schema = loadedSchema ?? undefined;

    // 获取要验证的文件
    let files: string[];

    if (staged) {
      files = await this.getStagedFiles(cwd);
    } else {
      files = await this.getSpecFiles(cwd);
    }

    // 过滤只保留 Spec 相关文件
    const specFiles = files.filter(f => this.isSpecFile(f));

    // 验证每个文件
    for (const file of specFiles) {
      const result = await this.validateFile(file, schema);
      results.push(result);
    }

    // 统计结果
    const passed = results.filter(r => r.valid).length;
    const failed = results.filter(r => !r.valid).length;
    const warnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

    return {
      total: specFiles.length,
      passed,
      failed,
      warnings,
      results,
    };
  }

  /**
   * 获取 Spec 文件
   */
  private async getSpecFiles(cwd: string): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of this.config.files) {
      const files = await glob.glob(pattern, {
        cwd,
        absolute: true,
        ignore: ['node_modules/**', 'dist/**', '.git/**'],
      });
      allFiles.push(...files);
    }

    return [...new Set(allFiles)];
  }

  /**
   * 获取暂存的 Spec 文件
   *
   * git 事实经 GitEvidence adapter（ADR-0021）；`run` 缺省真 git，测试注入替身。
   */
  private async getStagedFiles(cwd: string, run?: GitCommandRunner): Promise<string[]> {
    const evidence = createGitEvidence(cwd, run);
    return splitFileNames(evidence.changedFileNames(true))
      .filter(f => this.isSpecFile(f))
      .map(f => path.resolve(cwd, f));
  }

  /**
   * 判断是否为 Spec 文件
   */
  private isSpecFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    
    // ARCHITECTURE.md
    if (basename === 'architecture.md') return true;
    
    // specs 目录下的文件
    if (filePath.includes('specs/') || filePath.includes('spec/')) return true;
    
    // 符合配置的文件模式
    for (const pattern of this.config.files) {
      if (pattern.startsWith('specs/')) {
        // 检查路径是否匹配
        if (filePath.includes('/specs/')) return true;
      }
    }
    
    return false;
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 动态导入模块（fail-fast：导入失败抛出；唯一回退 = .ts 导入失败试编译后的同名 .js）
   */
  private async dynamicImport(modulePath: string): Promise<unknown> {
    try {
      // 尝试直接导入
      return await import(modulePath);
    } catch (err) {
      // 如果是 TypeScript 文件，尝试加载编译后的 JS
      if (modulePath.endsWith('.ts')) {
        const jsPath = modulePath.replace(/\.ts$/, '.js');
        if (await this.fileExists(jsPath)) {
          return import(jsPath);
        }
      }
      throw err;
    }
  }
}
