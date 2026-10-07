/**
 * spec 前置条件判定（ADR-0020/0025 格局：判定纯函数住 core，采集与输出住 cli）
 *
 * 自 cli/commands/spec-baseline-check 下移（ADR-0040 Phase 3）：section 提取、
 * 逐条前置判定与其三个分类检查（文件存在 / 依赖 / 代码模式）是纯判定；
 * 判定消费的取数面是注入的 `BaselineIndex`——采集实现（全仓扫描 / package.json
 * 解析 / stat 探测）留在 cli 命令模块。
 */

import * as path from 'path';

/** 前置条件验证结果 */
export interface PrerequisiteResult {
  /** 前置条件描述 */
  prerequisite: string;
  /** 是否满足 */
  satisfied: boolean;
  /**
   * true = 识别不出前置条件类型，无法自动判定（satisfied 恒 false）：
   * 单独成类露出，退出码按未满足处理——不再默认 satisfied: true 假绿
   */
  undetermined?: boolean;
  /** 证据 */
  evidence: string;
}

/** package.json 依赖面的一次解析结果（缺失态同样入库，不重试；损坏在上游 readPackageJson 已抛） */
export type DependencySnapshot = { ok: true; deps: Record<string, string> } | { ok: false };

/**
 * 一次 spec-baseline-check 运行内的取数面（工单 #146，母票 #140 A 票）：
 * 全仓内容扫描、`package.json` 解析、同一落点的存在性探测各至多一遍，
 * 逐条前置只在索引上重放判定——此前是「前置条件数 × 关键词数 × 源文件数」的逐条重扫。
 *
 * 懒建：没有任何前置需要某类数据时，该类读取一次都不发生（口径与改前一致）。
 * 运行结束即弃，不跨命令、不扩 `RunEnv` 公共面（#140 triage 裁决 5）。
 */
export interface BaselineIndex {
  /** 内容含 keyword 的源文件数（驻留索引重放或回落逐文件流式读，实现侧口径） */
  countFilesContaining(keyword: string): number;
  /** package.json 的 dependencies + devDependencies 合并面 */
  dependencies(): DependencySnapshot;
  /** 绝对路径是否在世（同一落点一次运行内只 stat 一次） */
  exists(fullPath: string): boolean;
}

/**
 * 从 spec 内容中提取 Baseline/前置条件 section
 */
export function extractBaselineSection(content: string): string[] {
  const lines = content.split('\n');
  const prerequisites: string[] = [];

  // 查找 ## Baseline 或 ## 前置条件 section
  let inSection = false;
  let sectionLevel = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      // 检查是否是目标 section
      if (/^(Baseline|前置条件|Prerequisites|Prereqs)$/i.test(title)) {
        inSection = true;
        sectionLevel = level;
        continue;
      }

      // 同级或更高级的标题结束 section
      if (inSection && level <= sectionLevel) {
        inSection = false;
        continue;
      }
    }

    // 在 section 中提取列表项
    if (inSection) {
      const listMatch = line.match(/^\s*[-*+]\s+(.+)/);
      if (listMatch) {
        prerequisites.push(listMatch[1].trim());
      }
      // 也支持编号列表
      const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (numberedMatch) {
        prerequisites.push(numberedMatch[1].trim());
      }
    }
  }

  return prerequisites;
}

/**
 * 检查文件/目录是否存在
 */
function checkFileExists(
  pattern: string,
  projectPath: string,
  index: BaselineIndex
): { exists: boolean; evidence: string } {
  // 提取路径引用（反引号中的路径、引号中的路径、或直接的路径模式）
  const pathPatterns = [
    /`([^`]+\.[a-z]+)`/g,           // `src/foo.ts`
    /["']([^"']+\.[a-z]+)["']/g,    // "src/foo.ts"
    /`([^`]+\/)`/g,                  // `src/foo/`
    /(\S+\/\S+\.[a-z]+)/g,          // src/foo.ts
  ];

  const paths: string[] = [];
  for (const p of pathPatterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(pattern)) !== null) {
      paths.push(m[1]);
    }
  }

  if (paths.length === 0) {
    return { exists: false, evidence: '无法从描述中提取路径' };
  }

  const found: string[] = [];
  const missing: string[] = [];

  for (const p of paths) {
    const fullPath = path.resolve(projectPath, p);
    if (index.exists(fullPath)) {
      found.push(p);
    } else {
      missing.push(p);
    }
  }

  if (missing.length === 0 && found.length > 0) {
    return { exists: true, evidence: `文件存在: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `部分存在: ${found.join(', ')}; 缺失: ${missing.join(', ')}` };
  }
  return { exists: false, evidence: `文件不存在: ${missing.join(', ')}` };
}

/**
 * 检查代码中是否存在特定模式
 */
function checkCodePattern(pattern: string, index: BaselineIndex): { exists: boolean; evidence: string } {
  // 从描述中提取关键词
  const keywords: string[] = [];

  // 提取反引号中的代码
  const codePatterns = pattern.match(/`([^`]+)`/g);
  if (codePatterns) {
    for (const cp of codePatterns) {
      const inner = cp.slice(1, -1);
      if (inner.length >= 2) {
        keywords.push(inner);
      }
    }
  }

  // 提取 "implemented" / "exists" / "已实现" 等关键词后的内容
  const implMatch = pattern.match(/(?:implemented|exists|已实现|已完成|已存在)[\s:：]+(.+)/i);
  if (implMatch) {
    keywords.push(implMatch[1].trim());
  }

  if (keywords.length === 0) {
    return { exists: false, evidence: '无法从描述中提取搜索关键词' };
  }

  const found: string[] = [];
  const notFound: string[] = [];

  // 一次运行一份索引：全仓扫描与内容读取已在索引里发生一遍（超上限则回落流式），这里只做匹配
  for (const kw of keywords) {
    const count = index.countFilesContaining(kw);
    if (count > 0) {
      found.push(`${kw} (${count} files)`);
    } else {
      notFound.push(kw);
    }
  }

  if (notFound.length === 0 && found.length > 0) {
    return { exists: true, evidence: `代码中找到: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `找到: ${found.join(', ')}; 未找到: ${notFound.join(', ')}` };
  }
  return { exists: false, evidence: `代码中未找到: ${notFound.join(', ')}` };
}

/**
 * 检查包依赖是否安装
 */
function checkDependency(
  pattern: string,
  projectPath: string,
  index: BaselineIndex
): { exists: boolean; evidence: string } {
  // 提取包名
  const pkgPatterns = [
    /`(@?[\w-]+\/[\w-]+)`/g,      // `@scope/pkg` or `pkg-name`
    /`([\w-]+)`/g,                  // `pkg`
    /install(?:ed)?\s+(\S+)/gi,    // installed pkg-name
  ];

  const packages: string[] = [];
  for (const p of pkgPatterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(pattern)) !== null) {
      const pkg = m[1];
      if (pkg.length >= 2 && !pkg.includes('/') && !pkg.includes('.')) {
        packages.push(pkg);
      }
    }
  }

  if (packages.length === 0) {
    return { exists: false, evidence: '无法从描述中提取包名' };
  }

  const found: string[] = [];
  const missing: string[] = [];

  // 一次运行只读解析一遍 package.json（缺失态同样入库；损坏在上游已抛）
  const snapshot = index.dependencies();
  if (!snapshot.ok) {
    return { exists: false, evidence: 'package.json 不存在' };
  }
  const deps = snapshot.deps;

  for (const pkg of packages) {
    if (deps[pkg] || deps[`@types/${pkg}`]) {
      found.push(pkg);
    } else {
      // 检查 node_modules
      const nmPath = path.join(projectPath, 'node_modules', pkg);
      if (index.exists(nmPath)) {
        found.push(pkg);
      } else {
        missing.push(pkg);
      }
    }
  }

  if (missing.length === 0 && found.length > 0) {
    return { exists: true, evidence: `依赖已安装: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `已安装: ${found.join(', ')}; 缺失: ${missing.join(', ')}` };
  }
  return { exists: false, evidence: `依赖缺失: ${missing.join(', ')}` };
}

/**
 * 综合验证一条前置条件（取数一律经注入的共享索引 `index`）
 */
export function verifyPrerequisite(
  prereq: string,
  projectPath: string,
  index: BaselineIndex
): PrerequisiteResult {
  const lower = prereq.toLowerCase();

  // 路径/文件存在性检查
  if (lower.includes('文件') || lower.includes('file') || lower.includes('目录') || lower.includes('directory')
    || /`[^`]+\.[a-z]+`/.test(prereq) || /\//.test(prereq)) {
    const { exists, evidence } = checkFileExists(prereq, projectPath, index);
    if (exists || evidence.includes('文件不存在')) {
      return { prerequisite: prereq, satisfied: exists, evidence };
    }
  }

  // 依赖检查
  if (lower.includes('依赖') || lower.includes('install') || lower.includes('package') || lower.includes('npm')) {
    const { exists, evidence } = checkDependency(prereq, projectPath, index);
    return { prerequisite: prereq, satisfied: exists, evidence };
  }

  // 代码模式检查
  if (lower.includes('实现') || lower.includes('implement') || lower.includes('exist')
    || lower.includes('已') || lower.includes('必须')
    || /`[^`]+`/.test(prereq)) {
    const { exists, evidence } = checkCodePattern(prereq, index);
    return { prerequisite: prereq, satisfied: exists, evidence };
  }

  // 默认：识别不出前置条件类型——无法判定（单独成类，按未满足处理，不假绿放过）
  return {
    prerequisite: prereq,
    satisfied: false,
    undetermined: true,
    evidence: '无法自动判定（需人工确认）',
  };
}
