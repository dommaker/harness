/**
 * Token 估算——仓内唯一一把尺子（harness#197「双尺子合一」的正本落点）
 *
 * 从 `KnowledgeQuery.estimateTokens` 提出为独立纯函数（本票新增）：消费方要的是尺子，
 * 不该为了量一段文本先去持有一个带 store 的知识查询对象——下游真实的调用面是 30 处
 * 「拿函数直接用」的静态调用，改造面不该由尺子的取用形状来付。`KnowledgeQuery` 的方法名
 * 与语义不变，改为委托本函数——实现仍只有一份，不重新长出第二把尺子。
 */

/**
 * Estimate token count for a piece of text.
 * Rule of thumb: 1 CJK char ≈ 2 tokens, 1 ASCII char ≈ 0.25 tokens.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    // CJK Unified Ideographs + common CJK ranges（charCodeAt 区间判断，与原正则等价）：
    // U+3400–U+4DBF（Ext A）、U+4E00–U+9FFF（Unified）、U+F900–U+FAFF（兼容表意）
    const code = ch.charCodeAt(0);
    if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
      tokens += 2;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}
