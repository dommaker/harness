/**
 * 数值旗帜装配解析器（harness#154；口径正本 = src/cli/commands/CONTEXT.md
 * 「数值旗帜装配口径（harness#152）」条目，本模块是该条目指名的唯一解析器）
 *
 * 背景：commander 给到命令侧的数值旗帜恒是字符串（`defaultValue: '50'` 也是），
 * 数值只在装配点转一次，转不出来必须 fail-loud——下游兜底多是 `??`/`||`，
 * NaN 穿透后比较恒 false，一道质量判定被静默关掉而退出码仍是 0（#152 病灶）。
 * `parseInt`/`parseFloat` 不可用：它们前缀截断（'30abc'→30、'1e2'→1）同属静默误读。
 *
 * 两个消费形（同一条判定规则，不建第二套解析器）：
 * - `requireNumericFlag`：定义表 `mapActionArgs` 装配点用，脏值抛 `NumericFlagError`，
 *   bin/harness.js 捕获后映射 usage-error（非零退出）；
 * - `parseNumericFlag`：命令模块入口装配点用（knowledge/failure/passes-gate），
 *   返回值判别，就地 `logError` + `usage-error`。
 */

/** 数值形：int = 非负整数；float = 非负十进制（不收指数/符号/前后缀） */
export type NumericFlagKind = 'int' | 'float';

/** 装配结果：`ok: false` = 脏输入，由装配点 fail-loud（不得往判定槽塞 NaN） */
export type NumericFlagAssembly = { ok: true; value?: number } | { ok: false; raw: string };

/**
 * 装配窄化：`undefined` = 未传（落下游缺省）；`'0'` 是显式零值，不当「未传」兜掉。
 * 规则与 #152 `assembleShortContentThreshold` 同源：trim 后全数字（float 允许一段小数），
 * 溢出 double 上限（→ Infinity）同脏值处理。
 */
export function parseNumericFlag(raw: string | undefined, kind: NumericFlagKind): NumericFlagAssembly {
  if (raw === undefined) return { ok: true };
  const text = raw.trim();
  const pattern = kind === 'int' ? /^\d+$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(text)) return { ok: false, raw };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, raw };
  return { ok: true, value };
}

/** 报错文案模板：点名旗帜与原值（可定位），int/float 措辞一致收敛 */
export function numericFlagMessage(flag: string, raw: string, kind: NumericFlagKind): string {
  return `错误：${flag} 需要非负${kind === 'int' ? '整数' : '数值'}，收到 "${raw}"`;
}

/** 定义表装配失败的专用错误：bin/harness.js 凭它映射 usage-error（非零退出） */
export class NumericFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumericFlagError';
  }
}

/**
 * 定义表 `mapActionArgs` 装配点用：脏值抛 `NumericFlagError`。
 * 定义表是纯数据模块，返回不了 CommandResult；退出码映射唯一出口在 bin，
 * 故以抛出表达失败、bin 就地捕获映射，不新增第二条失败通道。
 */
export function requireNumericFlag(
  flag: string,
  raw: string | undefined,
  kind: NumericFlagKind,
): number | undefined {
  const result = parseNumericFlag(raw, kind);
  if (!result.ok) throw new NumericFlagError(numericFlagMessage(flag, result.raw, kind));
  return result.value;
}
