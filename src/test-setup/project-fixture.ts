/**
 * 测试项目夹具构造 API（架构评审 2026-09-02 候选11 / harness#90）
 *
 * 职责：建一个临时项目根并按声明落 fixture，替掉散在各测试套件的
 * `mkdtempSync + mkdir('.harness') + writeFileSync('config.yml')` 手写组合。
 *
 * 设计口径（triage 裁决）：
 * - **语义声明**而非文件树声明：`config` 是独立槽位（`.harness/config.yml` 的形状
 *   正本只有这里知道），其余文件走 `files` 相对路径。constraints/knowledge 槽位随后续票补。
 * - `config` 只收字符串、原样落盘：被检代码大量用例是畸形/脏配置（`governance: [`、
 *   `required_dirs: [1, null]`、未知 preset 名），YAML 往返会把这些用例抹平。
 * - 非缺省根必须经 `parentDir` **显式**声明：默认根统一为 tmpdir，
 *   路径锚定生产代码的用例（cwd 锚定）靠 opt-out 保持原语义，不隐式继承。
 * - 清理不在本模块做：根经 `fs.mkdtempSync` 创建，由 ./mkdtemp-cleanup 的劫持在
 *   afterAll 统一回收（setupFilesAfterEnv 已全局装载）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** config.yml 相对项目根的落点（全仓唯一处，测试与生产读取口径在此对齐） */
const CONFIG_REL = path.join('.harness', 'config.yml');

/** name 只允许小写字母数字与连字符——见 mkdtemp-cleanup 的超龄清扫签名，大写/下划线会让漏网目录永不被扫 */
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface ProjectFixtureDecl {
  /** 用例标签，进入 mkdtemp 前缀（残留目录可定位到用例）；小写连字符 */
  name: string;
  /** `.harness/config.yml` 内容，原样落盘；省略 = 不写该文件（未采用约定语义） */
  config?: string;
  /** 其余文件：相对路径 → 内容，父目录自动创建 */
  files?: Record<string, string>;
  /** 显式 opt-out：临时根的父目录，缺省 `os.tmpdir()`；cwd 锚定用例传 `process.cwd()` */
  parentDir?: string;
}

/** 写入（或覆盖）项目根的 `.harness/config.yml`——用例内后续改配置走这里，不再手拼路径 */
export function writeProjectConfig(projectRoot: string, content: string): void {
  const target = path.join(projectRoot, CONFIG_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 建临时项目根并落声明式 fixture，返回根路径 */
export function createProjectFixture(decl: ProjectFixtureDecl): string {
  if (!NAME_RE.test(decl.name)) {
    throw new Error(`project-fixture: name 必须是小写连字符标签（收到 "${decl.name}"），否则残留目录无法被超龄清扫识别`);
  }
  const parent = decl.parentDir ?? os.tmpdir();
  const root = fs.mkdtempSync(path.join(parent, `${decl.name}-`));
  if (decl.config !== undefined) writeProjectConfig(root, decl.config);
  for (const [rel, content] of Object.entries(decl.files ?? {})) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
  return root;
}
