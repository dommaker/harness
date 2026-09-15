/**
 * projectPath 传递约定守护（harness#95）
 *
 * 约定（正本见本目录 CONTEXT.md「约定」段）：**projectPath 只在 CLI 入口做一次 `|| process.cwd()`
 * 兜底，之后必须传到每个 IO/执行点**——下游禁止再取一次 cwd，也禁止用相对路径默认值
 * （两者都会让 `-p` 半失效：读写/执行位置悄悄回到调用方的 cwd）。
 *
 * 本文件是这条约定的机器可检面，四道闸：
 * 1. CLI 入口层：cwd 只能以 `xxx || process.cwd()` 的兜底形状出现，例外逐个点名并记理由
 * 2. 下游层（= src 减 cli，含 core / gates / context / monitoring / hooks 等）：cwd 站点**逐行**冻结
 *    （harness#98，不再只冻文件键集——豁免文件内新增站点/行变形同样失败），
 *    要么把根传下去，要么在此记下豁免理由
 * 3. 相对路径默认值同理冻结（harness#98 收紧：对象字面量 `xxxPath: '相对'` 之外，
 *    参数默认值形 `xxxPath = '相对'`（含类型标注）与模板字面量同罪；harness#139 再扩两形：
 *    键名后缀 `Path` → `Path|File|Log`，以及引用常量的 `xxxFile: SOME_CONST` 臂；扫描域 = 整个下游层）
 * 4. 组合根自己锚根构造，不再消费 cwd 锚定的全局单例（harness#139：src/cli、src/hooks 生产代码
 *    对 `getTraceCollector()` 零消费——单例是留给跨仓消费者的兼容面，不是本仓的取用口）
 *
 * 冻结集合还要求**每条豁免仍然成立**（站点消失却不删条目 → 同样失败），豁免不会烂成化石。
 * 「根参数已传入却又取 cwd」这类静态看不出的漂移，由 project-path-anchoring.test.ts 的真实 IO 行为用例守。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..', '..', '..', 'src');

/** 注释行不参与匹配：文档里「缺省 process.cwd()」这类描述不是站点 */
function codeLines(file: string): string[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'));
}

function listTsFiles(dir: string, skipDirs: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || skipDirs.includes(entry.name)) continue;
      found.push(...listTsFiles(full, skipDirs));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found.sort();
}

/** 仓库相对路径（豁免表以此为准，跨机器稳定） */
function repoPath(abs: string): string {
  return path.relative(path.join(SRC_ROOT, '..'), abs).split(path.sep).join('/');
}

function cwdSites(files: string[]): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  for (const file of files) {
    const lines = codeLines(file).filter(line => line.includes('process.cwd()'));
    if (lines.length > 0) sites.set(repoPath(file), lines);
  }
  return sites;
}

/** 闸 3 的取站点本体（反证用例与冻结表用例共用同一判据） */
function relativePathDefaultSites(files: string[]): Set<string> {
  const hits = new Set<string>();
  for (const file of files) {
    if (codeLines(file).some(line => RELATIVE_PATH_DEFAULT.test(line))) hits.add(repoPath(file));
  }
  return hits;
}

// ========================================
// 闸 1：CLI 入口层的非兜底形状 cwd
// ========================================

/** CLI 层的合法形状：入口对 `-p/--project-path` 做一次性兜底 */
const ENTRY_FALLBACK_SHAPE = /\|\|\s*process\.cwd\(\)/;

/** 兜底形状之外的 CLI cwd 站点：逐个裁决过，理由与站点原文一起冻结 */
const CLI_CWD_EXEMPTIONS: Record<string, { lines: string[]; reason: string }> = {
  'src/cli/commands/command.ts': {
    lines: ['const decision = await gate.evaluate({ projectPath: process.cwd(), command: cmd });'],
    reason:
      '统一门禁接口的 GateContext 要求项目根，而 CommandGate 只做命令串的正则判定、零文件读写；' +
      '本命令定义表里没有 -p/--project-path（只有 --level/--list/--json），' +
      '取真实 cwd 仅为满足上下文形状，不存在「给了 -p 却被 IO 绕回 cwd」的半失效路径。' +
      '架构评审候选1 步骤 2：六个门禁的判定统一穿过 evaluate()。',
  },
  'src/cli/commands/release.ts': {
    lines: ['const pkgPath = process.cwd();'],
    reason:
      'release 定义表里没有 -p/--project-path（只收 --bump/--dry-run），pkgPath 就是该命令唯一的根，' +
      '且已逐个传给每条 run(cmd, pkgPath) 与 verifyReleaseArtifacts(pkgPath)——不构成 -p 半失效。' +
      '给发布流水线新增 -p 属新能力（可指向任意目录做 push/publish），不在 #95 范围。',
  },
};

// ========================================
// 闸 2：下游层的 cwd 站点
// ========================================

/**
 * 下游豁免的共同理由：这些是**库层公开 API 的可选根参数默认值**（调用方没给根时的缺省），
 * 不是「根已经传进来了，取 IO 时又绕回 cwd」。core 不能 import cli，兜底只能留在各自入口，
 * 故冻结而非删除；新增站点必须在此逐个点名并单独说明。
 *
 * harness#98：冻结粒度从文件键集收紧到**行内容**——已豁免文件内悄悄新增 cwd 站点
 * （不动键集）曾是绕过通道，现在新增行/行变形都会顶失败。
 */
const DOWNSTREAM_CWD_EXEMPTIONS: Record<string, { lines: string[]; reason: string }> = {
  'src/context/session-manager.ts': {
    lines: ['this.basePath = basePath || process.cwd();'],
    reason: '构造参数 basePath 缺省（会话存储根，CLI 已显式传 projectPath）',
  },
  'src/core/constraints/checker.ts': {
    lines: [
      'const projectPath = context.projectPath || process.cwd();',
      'const projectPath = context.projectPath || process.cwd();',
      'const projectPath = context.projectPath || process.cwd();',
    ],
    reason:
      'check 三个 run 入口（checkPrecondition / runAllConstraints / beforeExecution）各取一次根兜底，' +
      'git 证据与运行级观察面都从该变量派生、不再内联取 cwd（ADR-0023 步骤 3）',
  },
  'src/core/constraints/checkers/types.ts': {
    lines: ['const projectPath = context.projectPath || process.cwd();'],
    reason: 'checker 环境的根兜底（context.projectPath 可选）',
  },
  'src/core/constraints/context-builder.ts': {
    lines: [
      'const projectPath = options.projectPath || process.cwd();',
      'const projectPath = options.projectPath || process.cwd();',
    ],
    reason: 'buildCheckEnv 的 options.projectPath 缺省兜底（2 处）',
  },
  'src/core/constraints/run-env.ts': {
    lines: ['return createRunEnv(target || process.cwd());'],
    reason:
      'resolveRunEnv 的根兜底：RunTarget 只给了路径或什么也没给时自造一枚一次性观察面' +
      '（配置访问器族与 ProjectConfigLoader 的入参归一点，ADR-0023 决策 2）',
  },
  'src/core/constraints/usage-report.ts': {
    lines: ['projectRoot: string = process.cwd(),'],
    reason: 'projectRoot 形参默认值（库层可选根）',
  },
  'src/core/effective-constraints.ts': {
    lines: [
      'target: RunTarget = process.cwd(),',
      'target: RunTarget = process.cwd(),',
      'export function lintEffectiveConfig(projectRoot: string = process.cwd()): EffectiveConfigLint {',
    ],
    reason: '生效集三函数根形参默认值（库层可选根，JSDoc 已声明；前两者入参含 RunEnv，ADR-0023）',
  },
  'src/core/spec/validator.ts': {
    lines: ['const cwd = projectPath || process.cwd();'],
    reason: 'validateAll 的可选 projectPath 兜底（其相对 schemaPath 默认值见闸 3 豁免）',
  },
  'src/gates/checker-gate.ts': {
    lines: ['const projectPath = ctx.projectPath || process.cwd();'],
    reason: 'GateContext.projectPath 缺省兜底（门禁适配器的根入口）',
  },
  'src/hooks/bootstrap.ts': {
    lines: [
      'const resolvedPath = projectPath || process.cwd();',
      'const resolvedPath = projectPath || process.cwd();',
    ],
    reason: 'bootstrapHarness 的可选 projectPath 兜底（组合根入口，2 处）',
  },
  'src/monitoring/context-tracker.ts': {
    lines: ['const base = basePath || process.cwd();'],
    reason: 'basePath 构造参数缺省兜底',
  },
};

// ========================================
// 闸 3：下游层的相对路径默认值
// ========================================

/**
 * 键名必须是 camelCase 且以 Path/File/Log 结尾，值为相对字面量或引用常量——这类默认值按 cwd 解析，
 * 即 #95 的病根形状。
 *
 * harness#98 收紧匹配形状（原为只认对象字面量 `xxxPath: '相对'`）：
 * 参数默认值形 `xxxPath = '相对'`、带类型标注的 `xxxPath: string = '相对'`、模板字面量、
 * 双引号形同罪（仓内 lint 不强制引号风格，三种引号都得认）。
 *
 * harness#139 再扩两形（traceFile 病灶的形状是「键名不带 Path + 值引用常量」，原闸两头都不认）：
 * - 臂 1 的键名后缀 `Path` → `Path|File|Log`（落点类键名的全集，Log 覆盖 `xxxLog` 一族）
 * - 臂 2 新增常量引用形 `xxxFile: SOME_CONSTANT`（值不在本行，是相对片段正本的另一半）
 *
 * 只扫**使用点**，不冻结常量定义本体（`export const DEFAULT_TRACE_FILE = '.harness/…'` 是正本，
 * 锚定责任在消费点）。扩形后下游层新增命中恰好 2 处（本票病灶 traces.ts + trace-analyzer.ts 的
 * summaryFile），连同既有的 validator 豁免共 3 条，零假阳性——见下方豁免表。
 */
const RELATIVE_PATH_DEFAULT =
  /\b\w+(?:Path|File|Log)\s*(?::\s*[^=,)]+?)?[:=]\s*['"`](?!\/)|\b\w+(?:Path|File|Log)\s*[:=]\s*[A-Z][A-Z0-9_]+\b/;

const RELATIVE_PATH_DEFAULT_EXEMPTIONS: Record<string, string> = {
  'src/core/spec/validator.ts':
    'schemaPath: "./specs/schemas" 确实按 cwd 解析（同型病灶）。不随 #95 修：validateFile()/loadSchema() ' +
    '签名里没有根，补齐要把根穿透整个 spec 域（属 spec 重构，非本票两门禁）。CLI 侧 `spec -s` 已 ' +
    'path.resolve(projectPath, schema)，给了 -s 时口径正确。留待 spec 域单票收口。',
  'src/monitoring/traces.ts':
    'DEFAULT_CONFIG.traceFile 引用的是**项目相对片段**正本（#139 明确其语义），锚定在构造函数里做：' +
    '给了 projectPath → path.resolve(projectPath, traceFile)，没给 → 保持 cwd 解析（跨仓消费者的兼容面）。' +
    '本行是「相对片段」的声明处，不是「按 cwd 打开」的执行处；锚定行为由 monitoring/__tests__/' +
    'trace-file-anchoring.test.ts 与 cli/commands/__tests__/project-path-anchoring.test.ts 站点 3 钉。',
  'src/monitoring/trace-analyzer.ts':
    'summaryFile: ".harness/logs/traces-summary.json" 同型病灶（#139 实测的第二处命中）。不在本票修：' +
    'harness 侧无生产写点（`status` 自 ADR-0020 起直调纯函数，不构造 analyzer），修它等于给无人消费的面' +
    '新增根参数。与 trace 的 failure/summary 三件套同型病灶一并由 studio 侧迁移票带走（#139 Out of scope）。',
};

describe('projectPath 传递约定（harness#95）', () => {
  const cliFiles = listTsFiles(path.join(SRC_ROOT, 'cli'));
  const downstreamFiles = listTsFiles(SRC_ROOT).filter(f => !f.startsWith(path.join(SRC_ROOT, 'cli')));

  describe('闸 1：CLI 入口层的 cwd 只能是一次性兜底', () => {
    it('非兜底形状的 cwd 站点 = 冻结豁免表，且每条豁免仍然成立', () => {
      const offenders = new Map<string, string[]>();
      for (const [rel, lines] of cwdSites(cliFiles)) {
        const notFallback = lines.filter(line => !ENTRY_FALLBACK_SHAPE.test(line));
        if (notFallback.length > 0) offenders.set(rel, notFallback);
      }

      expect([...offenders.keys()].sort()).toEqual(Object.keys(CLI_CWD_EXEMPTIONS).sort());
      for (const [rel, exemption] of Object.entries(CLI_CWD_EXEMPTIONS)) {
        expect({ rel, lines: offenders.get(rel) }).toEqual({ rel, lines: exemption.lines });
      }
    });
  });

  describe('闸 2：下游层不得二次取 cwd', () => {
    it('下游 cwd 站点 = 冻结豁免表且逐行一致（新增文件/新增行/行变形/豁免化石都失败）', () => {
      const sites = cwdSites(downstreamFiles);

      expect([...sites.keys()].sort()).toEqual(Object.keys(DOWNSTREAM_CWD_EXEMPTIONS).sort());
      for (const [rel, exemption] of Object.entries(DOWNSTREAM_CWD_EXEMPTIONS)) {
        expect({ rel, lines: sites.get(rel) }).toEqual({ rel, lines: exemption.lines });
      }
    });

    it('PassesGate 执行侧不再取 cwd（站点 1 的收口形状：workDir 由调用方传入）', () => {
      const lines = codeLines(path.join(SRC_ROOT, 'core', 'validators', 'passes-gate.ts'));

      expect(lines.some(line => line.includes('process.cwd()'))).toBe(false);
      expect(lines.find(line => line.includes('async runTests'))).toContain('workDir');
    });
  });

  describe('闸 3：相对路径默认值不再按 cwd 解析', () => {
    it('下游层（= src 减 cli）的相对字面量/常量引用路径默认值 = 冻结豁免表', () => {
      expect([...relativePathDefaultSites(downstreamFiles)].sort()).toEqual(
        Object.keys(RELATIVE_PATH_DEFAULT_EXEMPTIONS).sort()
      );
    });

    it('acceptance 的 tasks.yml 默认不再有相对路径常量（站点 2 的收口形状）', () => {
      // 多行调用 → 拼成空白归一的整段文本再断言形状
      const body = codeLines(path.join(SRC_ROOT, 'gates', 'acceptance.ts')).join(' ').replace(/\s+/g, ' ');

      expect(body).not.toMatch(/tasksPath\s*:\s*'/);
      expect(body).toMatch(/path\.resolve\(\s*context\.projectPath\s*,\s*[^)]*'tasks\.yml'/);
    });

    it('反证（#139）：未锚的 xxxFile 相对默认值顶闸，锚定与绝对形状不误报', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate3probe-'));
      const write = (name: string, body: string): string => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, body, 'utf-8');
        return file;
      };

      // 臂 2（常量引用）与臂 1（File/Log 后缀的相对字面量）各自要真打得中，冻结表才不是空转
      expect([
        write('unanchored-const.ts', 'export const cfg = { traceFile: DEFAULT_TRACE_FILE };\n'),
        write('unanchored-literal.ts', "export const cfg = { errorLog: 'logs/error.log' };\n"),
        write('unanchored-param.ts', "function f({ summaryPath = './x/y.json' }: { summaryPath?: string }) {}\n"),
      ].map(f => relativePathDefaultSites([f]).size)).toEqual([1, 1, 1]);

      // 锚定动作、绝对值、值非大写常量、键名不在后缀集内 → 都不算站点
      expect([
        write('anchored.ts', 'export const cfg = { traceFile: path.resolve(projectPath, DEFAULT_TRACE_FILE) };\n'),
        write('absolute.ts', "export const cfg = { traceFile: '/abs/traces.log' };\n"),
        write('lowercase-value.ts', 'export const cfg = { traceFile: resolvedFile };\n'),
        write('other-suffix.ts', 'export const cfg = { maxFileSize: 10 * 1024 * 1024 };\n'),
      ].map(f => relativePathDefaultSites([f]).size)).toEqual([0, 0, 0, 0]);
    });
  });

  describe('闸 4：组合根锚根构造，不消费 cwd 锚定的单例（harness#139）', () => {
    it('src/cli 与 src/hooks 的生产代码对 getTraceCollector() 零消费', () => {
      const offenders: string[] = [];
      for (const dir of ['cli', 'hooks']) {
        for (const file of listTsFiles(path.join(SRC_ROOT, dir))) {
          const lines = codeLines(file).filter(line => /getTraceCollector\s*\(/.test(line));
          if (lines.length > 0) offenders.push(`${repoPath(file)}: ${lines.join(' | ')}`);
        }
      }

      // 单例保留是给跨仓消费者的兼容面（#139 裁决：公共面不摘除）；本仓四个组合根各自
      // new TraceCollector({ projectPath })，取用口一旦复活，-p 就又半失效一次
      expect(offenders).toEqual([]);
    });
  });
});
