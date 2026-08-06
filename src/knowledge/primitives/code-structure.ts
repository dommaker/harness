/**
 * extractCodeStructure — Layer 1 代码结构提取（纯代码，零 LLM）
 *
 * 使用 TypeScript Compiler API 从 .ts 文件提取：
 * - 函数声明
 * - 类声明
 * - 接口声明
 * - 类型别名
 * - import 语句
 *
 * 每个声明附带 JSDoc 注释（如果有）。
 */

import * as fs from 'fs';
import * as path from 'path';
import type * as ts from 'typescript';

let tsLibCache: typeof import('typescript') | null | undefined;

/**
 * 懒加载 typescript(仅 devDependency):消费者未安装时功能降级为空结果
 */
type TsLib = typeof import('typescript');

function loadTypeScript(): TsLib | null {
  if (tsLibCache !== undefined) return tsLibCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tsLibCache = require('typescript') as typeof import('typescript');
  } catch {
    tsLibCache = null;
  }
  return tsLibCache;
}

/** 调用前必须经 loadTypeScript() 确认可用 */
function tsLib(): TsLib {
  return tsLibCache as TsLib;
}

export interface DeclarationInfo {
  name: string;
  signature: string;
  jsdoc?: string;
}

export interface ImportInfo {
  source: string;
  names: string[];
}

export interface CodeStructure {
  files: string[];
  functions: DeclarationInfo[];
  classes: DeclarationInfo[];
  interfaces: DeclarationInfo[];
  types: DeclarationInfo[];
  imports: ImportInfo[];
}

/**
 * 从目录中所有 .ts 文件提取代码结构。
 *
 * @param dir 目录路径
 * @returns CodeStructure JSON
 */
export function extractCodeStructure(dir: string): CodeStructure {
  const result: CodeStructure = {
    files: [],
    functions: [],
    classes: [],
    interfaces: [],
    types: [],
    imports: [],
  };

  if (!loadTypeScript()) return result;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  const tsFiles = entries
    .filter(e => e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) && !e.name.endsWith('.d.ts'))
    .map(e => e.name)
    .sort();

  result.files = tsFiles;

  for (const fileName of tsFiles) {
    const filePath = path.join(dir, fileName);
    const sourceText = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = tsLib().createSourceFile(fileName, sourceText, tsLib().ScriptTarget.Latest, true);

    extractFromFile(sourceFile, result);
  }

  return result;
}

function extractFromFile(sourceFile: ts.SourceFile, result: CodeStructure): void {
  tsLib().forEachChild(sourceFile, node => {
    if (tsLib().isFunctionDeclaration(node)) {
      const info = extractDeclaration(node, sourceFile);
      if (info) result.functions.push(info);
    } else if (tsLib().isClassDeclaration(node)) {
      const info = extractDeclaration(node, sourceFile);
      if (info) result.classes.push(info);
    } else if (tsLib().isInterfaceDeclaration(node)) {
      const info = extractDeclaration(node, sourceFile);
      if (info) result.interfaces.push(info);
    } else if (tsLib().isTypeAliasDeclaration(node)) {
      const info = extractDeclaration(node, sourceFile);
      if (info) result.types.push(info);
    } else if (tsLib().isImportDeclaration(node)) {
      const importInfo = extractImport(node, sourceFile);
      if (importInfo) result.imports.push(importInfo);
    }
  });
}

function extractDeclaration(
  node: ts.FunctionDeclaration | ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile,
): DeclarationInfo | undefined {
  const name = node.name?.getText(sourceFile);
  if (!name) return undefined;

  const signature = node.getText(sourceFile).split('\n')[0].trim();
  const jsdoc = extractJSDoc(node, sourceFile);

  return { name, signature, jsdoc };
}

function extractImport(node: ts.ImportDeclaration, sourceFile: ts.SourceFile): ImportInfo | undefined {
  const moduleSpecifier = node.moduleSpecifier;
  if (!tsLib().isStringLiteral(moduleSpecifier)) return undefined;

  const source = moduleSpecifier.text;
  const names: string[] = [];

  if (node.importClause) {
    if (node.importClause.name) {
      names.push(node.importClause.name.getText(sourceFile));
    }
    if (node.importClause.namedBindings) {
      if (tsLib().isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          names.push(element.name.getText(sourceFile));
        }
      }
    }
  }

  return { source, names };
}

function extractJSDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const jsDocTags = tsLib().getJSDocTags(node);
  const fullText = sourceFile.getFullText();
  const nodeStart = node.getFullStart();

  // Look backwards for JSDoc comment
  const leadingCommentRanges = tsLib().getLeadingCommentRanges(fullText, nodeStart);
  if (!leadingCommentRanges) return undefined;

  for (const range of leadingCommentRanges) {
    const commentText = fullText.substring(range.pos, range.end);
    if (commentText.startsWith('/**')) {
      // Strip /** and */ and clean up
      return commentText
        .replace(/^\/\*\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, ''))
        .filter(line => line.trim().length > 0)
        .join(' ')
        .trim();
    }
  }

  return undefined;
}
