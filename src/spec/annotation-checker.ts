/**
 * 代码注释规范检查器
 *
 * 检查代码中的 @spec 注释是否规范
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

export interface AnnotationCheckResult {
  valid: boolean;
  file: string;
  annotations: SpecAnnotation[];
  errors: AnnotationError[];
  warnings: AnnotationWarning[];
}

export interface SpecAnnotation {
  specId: string;
  implements?: string[];
  acceptance?: string[];
  dependencies?: string[];
  author?: string;
  since?: string;
  line: number;
  type: 'class' | 'method' | 'function' | 'inline';
}

export interface AnnotationError {
  line: number;
  message: string;
  code: 'MISSING_SPEC' | 'INVALID_SPEC_FORMAT' | 'SPEC_NOT_APPROVED' | 'IMPLEMENTS_NOT_FOUND';
}

export interface AnnotationWarning {
  line: number;
  message: string;
  code: 'MISSING_IMPLEMENTS' | 'MISSING_ACCEPTANCE' | 'MISSING_AUTHOR';
}

// Spec ID 格式: AR-XXX, WS-XXX, etc.
const SPEC_ID_REGEX = /^[A-Z]{2,3}-\d{3}$/;

/**
 * 检查单个文件
 */
export function checkFile(filePath: string): AnnotationCheckResult {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const result: AnnotationCheckResult = {
    valid: true,
    file: filePath,
    annotations: [],
    errors: [],
    warnings: [],
  };

  let inJSDoc = false;
  let currentJSDoc: string[] = [];
  let currentJSDocStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // JSDoc 开始
    if (line.startsWith('/**')) {
      inJSDoc = true;
      currentJSDoc = [line];
      currentJSDocStartLine = i + 1;
      continue;
    }

    // JSDoc 结束
    if (inJSDoc && line.endsWith('*/')) {
      inJSDoc = false;
      currentJSDoc.push(line);
      
      const annotation = parseJSDoc(currentJSDoc, currentJSDocStartLine);
      if (annotation) {
        result.annotations.push(annotation);
        validateAnnotation(annotation, result);
      }
      
      currentJSDoc = [];
      continue;
    }

    // JSDoc 中间
    if (inJSDoc) {
      currentJSDoc.push(line);
    }

    // 行内注释 // @spec AR-001
    const inlineMatch = line.match(/\/\/\s*@spec\s+(\S+)/);
    if (inlineMatch) {
      const specId = inlineMatch[1];
      const annotation: SpecAnnotation = {
        specId,
        line: i + 1,
        type: 'inline',
      };
      result.annotations.push(annotation);
      validateAnnotation(annotation, result);
    }
  }

  // 检查公共导出是否有注释
  checkPublicExports(content, result);

  result.valid = result.errors.length === 0;
  return result;
}

/**
 * 解析 JSDoc 注释
 */
function parseJSDoc(lines: string[], startLine: number): SpecAnnotation | null {
  const content = lines.join('\n');
  
  // 检查是否有 @spec
  const specMatch = content.match(/@spec\s+(\S+)/);
  if (!specMatch) {
    return null;
  }

  const specId = specMatch[1];
  
  // 解析其他标签
  const annotation: SpecAnnotation = {
    specId,
    line: startLine,
    type: inferType(content),
  };

  // @implements
  const implementsMatch = content.match(/@implements\s+([\w\-_,\s]+)/);
  if (implementsMatch) {
    annotation.implements = implementsMatch[1]
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // @acceptance
  const acceptanceMatch = content.match(/@acceptance\s+([\w\-_,\s]+)/);
  if (acceptanceMatch) {
    annotation.acceptance = acceptanceMatch[1]
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // @dependencies
  const depsMatch = content.match(/@dependencies\s+([\w\-_,\s/]+)/);
  if (depsMatch) {
    annotation.dependencies = depsMatch[1]
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // @author
  const authorMatch = content.match(/@author\s+(\S+)/);
  if (authorMatch) {
    annotation.author = authorMatch[1];
  }

  // @since
  const sinceMatch = content.match(/@since\s+(\d{4}-\d{2}-\d{2})/);
  if (sinceMatch) {
    annotation.since = sinceMatch[1];
  }

  return annotation;
}

/**
 * 推断注释类型
 */
function inferType(content: string): SpecAnnotation['type'] {
  if (content.includes('class ')) return 'class';
  if (content.includes('async ') || content.includes('function ')) return 'function';
  return 'method';
}

/**
 * 验证注释
 */
function validateAnnotation(
  annotation: SpecAnnotation,
  result: AnnotationCheckResult
): void {
  // 检查 Spec ID 格式
  if (!SPEC_ID_REGEX.test(annotation.specId)) {
    result.errors.push({
      line: annotation.line,
      message: `Invalid spec ID format: ${annotation.specId}`,
      code: 'INVALID_SPEC_FORMAT',
    });
  }

  // 警告：建议标记 @implements
  if (!annotation.implements && annotation.type !== 'inline') {
    result.warnings.push({
      line: annotation.line,
      message: 'Missing @implements tag',
      code: 'MISSING_IMPLEMENTS',
    });
  }

  // 警告：建议标记 @acceptance
  if (!annotation.acceptance) {
    result.warnings.push({
      line: annotation.line,
      message: 'Missing @acceptance tag',
      code: 'MISSING_ACCEPTANCE',
    });
  }
}

/**
 * 检查公共导出是否有注释
 */
function checkPublicExports(content: string, result: AnnotationCheckResult): void {
  // 查找 export class/function 但没有 @spec 的
  const exportRegex = /^(export\s+(?:abstract\s+)?(?:class|interface|function|const|let|var))\s+(\w+)/gm;
  let match;
  
  while ((match = exportRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    const name = match[2];
    
    // 检查前10行是否有 @spec
    const beforeContent = content.substring(
      Math.max(0, match.index - 500),
      match.index
    );
    
    if (!beforeContent.includes('@spec')) {
      result.warnings.push({
        line,
        message: `Public export "${name}" missing @spec annotation`,
        code: 'MISSING_SPEC' as any,
      });
    }
  }
}

/**
 * 递归获取目录下所有文件
 */
function getFilesRecursively(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // 跳过 node_modules 和 dist
        if (item === 'node_modules' || item === 'dist') {
          continue;
        }
        files.push(...getFilesRecursively(fullPath, extensions));
      } else if (stat.isFile()) {
        const ext = path.extname(item);
        if (extensions.includes(ext) && !item.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // 目录不存在或无法访问
  }
  
  return files;
}

/**
 * 批量检查目录
 */
export function checkDirectory(
  dir: string,
  options: { extensions?: string[] } = {}
): AnnotationCheckResult[] {
  const extensions = options.extensions || ['.ts', '.tsx', '.js', '.jsx'];
  const files = getFilesRecursively(dir, extensions);

  return files.map(file => checkFile(file));
}

/**
 * 生成报告
 */
export function generateReport(results: AnnotationCheckResult[]): string {
  const totalFiles = results.length;
  const validFiles = results.filter(r => r.valid).length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

  let report = `## 注释规范检查报告\n\n`;
  report += `- 检查文件: ${totalFiles}\n`;
  report += `- 通过: ${validFiles}/${totalFiles}\n`;
  report += `- 错误: ${totalErrors}\n`;
  report += `- 警告: ${totalWarnings}\n\n`;

  if (totalErrors > 0) {
    report += `### ❌ 错误\n\n`;
    for (const result of results) {
      for (const error of result.errors) {
        report += `- ${result.file}:${error.line} - ${error.message}\n`;
      }
    }
    report += '\n';
  }

  if (totalWarnings > 0) {
    report += `### ⚠️ 警告\n\n`;
    for (const result of results) {
      for (const warning of result.warnings.slice(0, 5)) {
        report += `- ${result.file}:${warning.line} - ${warning.message}\n`;
      }
    }
  }

  return report;
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args[0] || process.cwd();
  
  const results = checkDirectory(dir);
  console.log(generateReport(results));
  const hasErrors = results.some(r => r.errors.length > 0);
  process.exit(hasErrors ? 1 : 0);
}
