/**
 * YAML 读写唯一入口（#207：js-yaml → yaml@2）。
 *
 * 全仓唯一 import 'yaml' 的模块；调用方一律经本模块，不允许直接依赖 yaml 包。
 * merge:true 对齐 js-yaml 的合并键（<<）默认展开口径；空文档返回 null（js-yaml 为 undefined）。
 * 需保留注释的读-改-写走 loadDocument / dumpDocument（harness#210），普通值投影仍走 load / dump。
 */

import { parse, parseDocument, stringify } from 'yaml';

export type YamlDocument = ReturnType<typeof parseDocument>;

/** 解析 YAML 文本（合并键展开；空文档返回 null） */
export function load(text: string): unknown {
  return parse(text, { merge: true });
}

/** 解析为保留注释的 YAML Document（供读-改-写受管键） */
export function loadDocument(text: string): YamlDocument {
  return parseDocument(text, { merge: true });
}

/** 序列化为 YAML 文本（options 透传给 yaml@2 stringify） */
export function dump(value: unknown, options?: { lineWidth?: number; indent?: number }): string {
  return stringify(value, options);
}

/** 序列化保留注释的 YAML Document */
export function dumpDocument(document: YamlDocument, options?: { lineWidth?: number; indent?: number }): string {
  return document.toString(options);
}
