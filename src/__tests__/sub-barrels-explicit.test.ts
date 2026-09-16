/**
 * 子 barrel 显式清单闸（harness#137，判据同 ADR-0003 / ADR-0022）
 *
 * ADR-0003 的「禁 export *」此前只钉到五个 `exports` 入口（`public-type-surface.test.ts`
 * 的写法白名单闸），子目录 `index.ts` 的星号再导出不受管——星号让「这个 barrel 到底
 * 对外给了什么」无法按名字回答，同名遮蔽（两个 `types.ts` 撞名）也在此处静默发生。
 * 本闸把它扩到 src 下全部 barrel：**逐文件、逐条**登记豁免，未登记的 `export *` 即红。
 *
 * 与两道公共面闸的分工：入口清单（`src/index.ts` 等五个）由 `public-type-surface.test.ts`
 * 与 `public-value-surface.test.ts` 逐字冻结，本闸不重复钉入口，只管**入口之外**的目录级
 * barrel；新增子 barrel 星号由本闸管住。
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '..');

/**
 * 已核无星号的 barrel 若日后引入 `export *`，需要在这里登记理由。
 * 当前为空：harness#137 已把 8 处目录级星号全部改成显式清单（`failure/types.ts` 那处
 * 是兼容再导出 shim，随票删除而非改写清单）。
 */
const STAR_EXEMPTIONS: Record<string, string> = {};

/** 收集 src 下所有目录级 barrel（`<dir>/index.ts`），不含 `__tests__` 内的测试辅助文件 */
function listBarrels(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory() || entry.name === '__tests__') continue;
    const indexTs = path.join(full, 'index.ts');
    if (fs.existsSync(indexTs)) out.push(indexTs);
    listBarrels(full, out);
  }
  return out;
}

/** 行首 `export *` / `export type *` / `export * as ns`（去注释后判定） */
const STAR_EXPORT_RE = /^export\s+(?:type\s+\*)\s*|^export\s+\*/;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function starExports(barrel: string): string[] {
  const text = stripComments(fs.readFileSync(barrel, 'utf-8'));
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => STAR_EXPORT_RE.test(line));
}

describe('子 barrel 显式清单（harness#137）', () => {
  const barrels = [path.join(SRC_DIR, 'index.ts'), ...listBarrels(SRC_DIR)];

  it('扫到了 barrel（扫空即说明遍历失效，不得假绿）', () => {
    expect(barrels.length).toBeGreaterThan(5);
  });

  it('src 下每个目录 barrel 都不含 `export *`（豁免须逐条登记理由）', () => {
    const offenders = barrels
      .map(barrel => ({
        barrel: path.relative(SRC_DIR, barrel),
        stars: starExports(barrel),
      }))
      .filter(entry => entry.stars.length > 0 && !STAR_EXEMPTIONS[entry.barrel]);
    expect(offenders).toEqual([]);
  });

  it('豁免登记是死账：登记过却已无星号的条目须撤销（防豁免面只增不减）', () => {
    const stale = Object.keys(STAR_EXEMPTIONS).filter(
      rel => !starExports(path.join(SRC_DIR, rel)).length
    );
    expect(stale).toEqual([]);
  });

  it('failure/types.ts 兼容再导出 shim 已删除（转发链第三跳收口）', () => {
    // 正本在 src/types/failure.ts（工单 14 归位），原模块路径经双仓核实无引用方
    expect(fs.existsSync(path.join(SRC_DIR, 'failure', 'types.ts'))).toBe(false);
  });

  it('failure barrel 直连类型正本，不再经 shim 中转', () => {
    const text = stripComments(fs.readFileSync(path.join(SRC_DIR, 'failure', 'index.ts'), 'utf-8'));
    expect(text).toContain("from '../types/failure'");
    expect(text).not.toMatch(/from '\.\/types'/);
  });
});
