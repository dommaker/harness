/**
 * AGENTS.md 同步器（工单 22）：agent 导读生成（项目简介/目录结构/常用命令/约束治理/知识入口）
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { loadRawProjectConfig } from '../../../core/project-config-loader';
import {
  readPackageJsonLite,
  getConfigDescription,
  detectPackageManager,
  formatScriptCommand,
} from './project-reader';

/** 生成 AGENTS.md 目录结构表时跳过的目录（依赖/构建产物/报告等） */
const AGENTS_MD_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  'playwright-report', 'test-results', '.git', '.next', '.turbo',
]);

/** 知名顶层目录的一句话说明 */
const AGENTS_MD_DIR_ROLES: Record<string, string> = {
  docs: '项目文档',
  scripts: '工具脚本',
  tests: '测试',
  test: '测试',
  bin: '可执行入口/脚本',
  templates: '项目模板',
  '.github': 'CI/CD 配置',
  '.harness': 'harness 配置与运行时状态',
};

/** 常用命令候选（按展示顺序），仅列出 package.json 中实际存在的脚本 */
const AGENTS_MD_COMMANDS: Array<[string, string]> = [
  ['dev', '启动开发环境'],
  ['build', '构建'],
  ['test', '运行测试'],
  ['test:e2e', '端到端测试'],
  ['test:unit', '单元测试'],
  ['typecheck', '类型检查'],
  ['lint', '代码检查'],
  ['start', '启动生产服务'],
];

export interface GovernanceInfo {
  hasConfig: boolean;
  preset?: string;
  hasClaudeGovernance: boolean;
  ironLaws?: number;
  guidelines?: number;
}

/**
 * 生成 AGENTS.md 内容（agent 导读：项目简介/目录结构/常用命令/约束治理/知识入口）
 *
 * 纯静态提取（零 LLM），确定性输出：同一代码库状态生成同一内容（无时间戳），
 * 因此重跑幂等。既有文件中的 PRESERVE 标记块由 composeAgentsMd 组合回输出，
 * --check 对组合结果做文本对比检测漂移（块内手改不报漂移）。
 */
export async function buildAgentsMd(projectPath: string, srcDirs: string[]): Promise<string> {
  const pkg = await readPackageJsonLite(projectPath);
  const [dirs, governance, hasKnowledge, hasStudioContext, contextDocCount] = await Promise.all([
    getTopLevelDirEntries(projectPath, srcDirs),
    getGovernanceInfo(projectPath),
    hasKnowledgeDir(projectPath),
    hasStudioContextDoc(projectPath),
    countContextDocs(projectPath, srcDirs),
  ]);

  const name = pkg?.name || path.basename(projectPath);
  const description = pkg?.description || await getConfigDescription(projectPath);

  const lines: string[] = [
    '# AGENTS.md',
    '',
    '> 本文件由 `harness sync-docs --agents` 自动生成，请勿手改。`<!-- PRESERVE:名称 -->` 与 `<!-- /PRESERVE:名称 -->` 之间的内容在重新生成时原样保留。内容漂移时重新运行该命令更新。',
    '',
    '## 项目简介',
    '',
    description ? `**${name}** — ${description}` : `**${name}**`,
    '',
    '## 目录结构',
    '',
  ];

  if (dirs.length > 0) {
    lines.push('| 目录 | 说明 |', '|------|------|');
    for (const d of dirs) {
      lines.push(`| \`${d.dir}/\` | ${d.role} |`);
    }
  } else {
    lines.push('（未检测到顶层目录）');
  }

  lines.push('', '## 常用命令', '');
  const pm = detectPackageManager(projectPath);
  const scripts = pkg?.scripts || {};
  const commands = AGENTS_MD_COMMANDS.filter(([n]) => scripts[n]);
  if (commands.length > 0) {
    lines.push('```bash');
    for (const [n, comment] of commands) {
      lines.push(`${formatScriptCommand(pm, n)}  # ${comment}`);
    }
    lines.push('```');
  } else {
    lines.push('（package.json 中未检测到常用脚本）');
  }

  lines.push('', '## 约束与治理', '');
  if (governance.hasConfig) {
    lines.push(`- 治理配置：\`.harness/config.yml\`${governance.preset ? `（preset: ${governance.preset}）` : ''}`);
  }
  if (governance.hasClaudeGovernance) {
    const counts = [
      governance.ironLaws !== undefined ? `Iron Laws ${governance.ironLaws} 条` : null,
      governance.guidelines !== undefined ? `Guidelines ${governance.guidelines} 条` : null,
    ].filter(Boolean).join('、');
    lines.push(`- 约束清单：\`CLAUDE.md\` Governance Rules 块${counts ? `（${counts}）` : ''}`);
  }
  if (!governance.hasConfig && !governance.hasClaudeGovernance) {
    lines.push('- 未检测到 harness 治理配置，可运行 `harness init` 初始化');
  }

  lines.push('', '## 知识入口', '');
  if (hasKnowledge) {
    // 不写条目数：.harness/knowledge 通常不入 git，条数是环境状态，
    // 写进受 --check 漂移比对的文档会制造「必然过期」竞态（任何知识写入都使已提交文档过期）
    lines.push('- `.harness/knowledge/`：项目知识库，用 `harness knowledge` 查询');
  }
  if (hasStudioContext) {
    // 正本模型（studio #152/T12）：模块上下文沉淀归并到业务仓 .studio/CONTEXT.md，
    // 散置 CONTEXT.md 指引与该裁决矛盾，正本在场时整行替代
    lines.push('- 模块上下文正本：`.studio/CONTEXT.md`（模块锚点组织），改动代码时同步更新');
  } else {
    lines.push(
      contextDocCount > 0
        ? `- 各源码目录的 \`CONTEXT.md\` 是权威模块文档（现有 ${contextDocCount} 个），改动代码时同步更新`
        : '- 各源码目录的 `CONTEXT.md` 是权威模块文档，缺失目录可由 `harness sync-docs` 生成模板'
    );
  }
  lines.push('');

  return lines.join('\n');
}

/** 收集顶层目录及其一句话说明（排序保证确定性） */
async function getTopLevelDirEntries(
  projectPath: string,
  srcDirs: string[]
): Promise<Array<{ dir: string; role: string }>> {
  let dirents: import('fs').Dirent[];
  try {
    dirents = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: Array<{ dir: string; role: string }> = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (AGENTS_MD_SKIP_DIRS.has(d.name)) continue;
    // 隐藏目录只保留 .harness / .github
    if (d.name.startsWith('.') && d.name !== '.harness' && d.name !== '.github') continue;
    entries.push({ dir: d.name, role: await describeTopLevelDir(projectPath, d.name, srcDirs) });
  }
  entries.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return entries;
}

/** 顶层目录的一句话说明：知名目录 → monorepo 成员 → 源码根 → 子包 description → 占位 */
async function describeTopLevelDir(projectPath: string, dir: string, srcDirs: string[]): Promise<string> {
  const known = AGENTS_MD_DIR_ROLES[dir];
  if (known) return known;

  if (dir === 'apps' || dir === 'packages') {
    const members = await listWorkspaceMembers(path.join(projectPath, dir));
    if (members.length > 0) {
      return `monorepo ${dir === 'apps' ? '应用' : '共享包'}：${members.join('、')}`;
    }
    return 'monorepo 工作区';
  }

  if (srcDirs.includes(dir)) return '源码目录';

  const subPkg = await readPackageJsonLite(path.join(projectPath, dir));
  if (subPkg?.description) return subPkg.description;

  return '—';
}

/** 列出 monorepo 工作区成员（含 package.json 的子目录名，排序） */
async function listWorkspaceMembers(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const members: string[] = [];
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      if (existsSync(path.join(dir, d.name, 'package.json'))) {
        members.push(d.name);
      }
    }
    return members.sort();
  } catch {
    return [];
  }
}

/** 收集治理信息：.harness/config.yml 与 CLAUDE.md 治理块（含铁律/指南计数） */
async function getGovernanceInfo(projectPath: string): Promise<GovernanceInfo> {
  const info: GovernanceInfo = { hasConfig: false, hasClaudeGovernance: false };

  try {
    const config = loadRawProjectConfig(projectPath);
    info.hasConfig = config !== undefined;
    if (config && typeof config.preset === 'string') {
      info.preset = config.preset;
    }
  } catch {
    // 配置不存在
  }

  try {
    const claude = await fs.readFile(path.join(projectPath, 'CLAUDE.md'), 'utf-8');
    if (/^##\s+Governance Rules/m.test(claude) || claude.includes('HARNESS_CONSTRAINTS_START')) {
      info.hasClaudeGovernance = true;
      info.ironLaws = countConstraintBullets(claude, 'Iron Laws');
      info.guidelines = countConstraintBullets(claude, 'Guidelines');
    }
  } catch {
    // CLAUDE.md 不存在
  }

  return info;
}

/** 统计 CLAUDE.md 指定约束分节下的条目数（`- **key**:` 行），分节不存在时返回 undefined */
function countConstraintBullets(content: string, section: string): number | undefined {
  const heading = new RegExp(`^###\\s+${section}[^\\n]*$`, 'm').exec(content);
  if (!heading) return undefined;
  const rest = content.slice(heading.index + heading[0].length);
  const end = rest.search(/^###\s|^\s*<!--\s*HARNESS_CONSTRAINTS_END/m);
  const block = end === -1 ? rest : rest.slice(0, end);
  const items = block.match(/^-\s+\*\*[A-Za-z0-9_]+\*\*/gm);
  return items ? items.length : 0;
}

/** 判断 .harness/knowledge 目录是否存在（只判存在性，不统计条数——条数易变，见 buildAgentsMd 注释） */
async function hasKnowledgeDir(projectPath: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(projectPath, '.harness', 'knowledge'))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 判断 .studio/CONTEXT.md 是否存在（正本模型标记，studio #152/T12）：
 * 模块上下文沉淀归并到业务仓单一正本（模块锚点组织）时，知识入口行改指正本，
 * 不再输出散置 CONTEXT.md 指引。只判存在性，不解析内容。
 */
async function hasStudioContextDoc(projectPath: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(projectPath, '.studio', 'CONTEXT.md'))).isFile();
  } catch {
    return false;
  }
}

/** 统计源码根内的 CONTEXT.md 数量（含源码根本身，跨根去重） */
async function countContextDocs(projectPath: string, srcDirs: string[]): Promise<number> {
  const found = new Set<string>();

  async function scan(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      const entryPath = path.join(dir, entry.name);
      if (existsSync(path.join(entryPath, 'CONTEXT.md'))) {
        found.add(entryPath);
      }
      await scan(entryPath);
    }
  }

  for (const root of srcDirs) {
    const rootPath = path.join(projectPath, root);
    if (existsSync(path.join(rootPath, 'CONTEXT.md'))) {
      found.add(rootPath);
    }
    await scan(rootPath);
  }
  return found.size;
}
