/**
 * Spec 验证器
 * 
 * 框架提供验证机制，项目定义自己的 Spec Schema
 * 
 * 设计原则：
 * - 框架不包含具体 Schema 定义
 * - 动态加载项目的 Schema
 * - 支持 Zod / JSON Schema / 自定义验证器
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as glob from 'fast-glob';
import { execAsync } from '../../utils/exec';
import type {
  SpecValidatorConfig,
  SpecValidationResult,
  BatchSpecValidationResult,
  SpecSchemaDefinition,
  SpecType,
} from '../../types/spec';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SpecValidatorConfig = {
  enabled: true,
  schemaPath: './specs/schemas',
  files: ['ARCHITECTURE.md', 'specs/**/*.yml', 'specs/**/*.yaml'],
  failureLevel: 'error',
};

/**
 * Spec 验证器
 */
export class SpecValidator {
  private static instance: SpecValidator;
  private config: SpecValidatorConfig;
  private schemaCache: Map<string, SpecSchemaDefinition> = new Map();

  private constructor(config?: Partial<SpecValidatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<SpecValidatorConfig>): SpecValidator {
    if (!SpecValidator.instance) {
      SpecValidator.instance = new SpecValidator(config);
    }
    return SpecValidator.instance;
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<SpecValidatorConfig>): void {
    this.config = { ...this.config, ...config };
    this.schemaCache.clear();
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

    try {
      // 尝试加载 TypeScript/JavaScript 模块
      const indexPath = path.join(absolutePath, 'index.ts');
      const indexPathJs = path.join(absolutePath, 'index.js');

      let schemaModule: any;

      if (await this.fileExists(indexPath)) {
        // 动态导入 TypeScript 模块（需要 tsx 或编译后的 .js）
        schemaModule = await this.dynamicImport(indexPath);
      } else if (await this.fileExists(indexPathJs)) {
        schemaModule = await this.dynamicImport(indexPathJs);
      } else {
        // 尝试直接加载指定文件
        schemaModule = await this.dynamicImport(absolutePath);
      }

      if (schemaModule && schemaModule.validate) {
        const schema: SpecSchemaDefinition = {
          name: schemaModule.name || 'custom',
          version: schemaModule.version,
          validate: schemaModule.validate,
        };
        this.schemaCache.set(schemaPath, schema);
        return schema;
      }

      return null;
    } catch (error) {
      // Schema 加载失败是正常的（项目可能没有自定义 Schema）
      return null;
    }
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
    const errors: any[] = [];
    const warnings: any[] = [];

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
        const yaml = await import('js-yaml');
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

    // 加载项目的 Schema
    const loadedSchema = await this.loadSchema(this.config.schemaPath);
    const schema = loadedSchema ?? undefined;

    // 获取要验证的文件
    let files: string[];

    if (staged) {
      files = await this.getStagedFiles();
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
   */
  private async getStagedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git diff --cached --name-only');
      const allFiles = stdout.trim().split('\n').filter(Boolean);
      return allFiles.filter(f => this.isSpecFile(f));
    } catch {
      return [];
    }
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
   * 动态导入模块
   */
  private async dynamicImport(modulePath: string): Promise<any> {
    try {
      // 尝试直接导入
      return await import(modulePath);
    } catch {
      // 如果是 TypeScript 文件，尝试加载编译后的 JS
      if (modulePath.endsWith('.ts')) {
        const jsPath = modulePath.replace(/\.ts$/, '.js');
        try {
          return await import(jsPath);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

/**
 * 便捷函数
 */
export async function validateSpec(
  filePath: string,
  schemaPath?: string
): Promise<SpecValidationResult> {
  const validator = SpecValidator.getInstance();
  if (schemaPath) {
    const loadedSchema = await validator.loadSchema(schemaPath);
    return validator.validateFile(filePath, loadedSchema ?? undefined);
  }
  return validator.validateFile(filePath);
}

export async function validateAllSpecs(
  projectPath?: string,
  staged?: boolean
): Promise<BatchSpecValidationResult> {
  const validator = SpecValidator.getInstance();
  return validator.validateAll(projectPath, staged);
}
