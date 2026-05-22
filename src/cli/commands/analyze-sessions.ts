/**
 * harness analyze-sessions — 对话模式发现引擎
 *
 * 扫描 transcript 文件，不预设关键词，挖掘：
 *   1. 纠正信号（用户反复指出的问题）
 *   2. 高频 N-gram（跨会话重复出现的概念）
 *   3. 规则缺口（高频模式未被现有 memory 覆盖）
 *
 * 输出候选规则建议，供用户审核后写入 memory。
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AnalyzeSessionsOptions {
  days?: number;
  projectPath?: string;
  json?: boolean;
}

interface Correction {
  sentence: string;
  sessionId: string;
  timestamp: string;
}

interface PatternCandidate {
  pattern: string;           // 被纠正/重复的概念
  frequency: number;          // 跨会话出现次数
  sessions: string[];         // 出现的会话 ID
  source: 'correction' | 'ngram';  // 来源
  confidence: number;         // 0-1
  suggestedRule: string;      // 建议的规则名
}

// ── Correction pattern templates ──
// Match user sentences that indicate repeating a request
const CORRECTION_PATTERNS = [
  /你(?:又|还是)(?:在)?(?:犯|忘|没|不).{0,20}?[了]?/g,
  /我不是(?:说|让|让做|讲)[了过]?.{0,30}?[了吗?]?/g,
  /怎么(?:又|还|老)(?:是|在)?.{0,20}?[了]?/g,
  /我(?:一直|反复|总是)(?:在|说|强调)?.{0,20}?[了]?/g,
  /老(?:是|在|犯|忘)(?:了)?.{0,20}?[了]?/g,
  /这(?:个|种)(?:问题|模式|错误).{0,20}?[.。！]?/g,
  /(?:第[一二三四五六七八九十\d]+次|反复|重复)(?:说|提醒|强调).{0,20}?/g,
  /不(?:要|能|想|愿意).{0,20}?老.{0,10}?[了]?/g,
  /(?:补上|加上|记上|修复).{0,10}?[了吗?？]?/g,
  /(?:沉淀|监控|日志|记录).{0,5}?[了吗?？]?/g,
];

// ── N-gram stop words ──
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  '因为', '所以', '但是', '而且', '如果', '虽然', '可以', '这个', '那个',
  '什么', '怎么', '哪', '吗', '吧', '呢', '啊', '嗯', '哦',
]);

// ── Main ──

export async function analyzeSessions(options: AnalyzeSessionsOptions): Promise<void> {
  const transcriptDir = process.env.CLAUDE_TRANSCRIPTS_DIR
    || path.join(os.homedir(), '.claude', 'projects', '-root--claude');
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', '-root-projects', 'memory');
  const days = options.days || 7;

  if (!fs.existsSync(transcriptDir)) {
    console.log(chalk.yellow('No transcripts directory found'));
    return;
  }

  // 1. Scan transcripts
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = findSessions(transcriptDir, cutoff);

  if (sessions.length === 0) {
    console.log(chalk.yellow(`No sessions found in the last ${days} days`));
    return;
  }

  // 2. Extract corrections + N-grams
  const corrections = extractCorrections(sessions);
  const ngrams = extractNGrams(sessions, { minLen: 4, maxLen: 24, minFreq: 2 });

  // 3. Load existing memory rules for gap detection
  const existingRules = loadExistingRules(memoryDir);

  // 4. Generate candidates
  const candidates = generateCandidates(corrections, ngrams, existingRules);

  // 5. Output
  if (options.json) {
    console.log(JSON.stringify({ sessions: sessions.length, corrections: corrections.length, candidates }, null, 2));
    return;
  }

  console.log(chalk.blue(`🔍 Analyzing ${sessions.length} sessions (last ${days} days)...\n`));

  printCorrectionSummary(corrections);
  printCandidates(candidates, existingRules);
}

// ── Scan ──

interface Session {
  id: string;
  date: string;
  turns: Array<{ role: string; content: string }>;
}

function findSessions(dir: string, cutoff: number): Session[] {
  const sessions: Session[] = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) continue;

      const turns: Array<{ role: string; content: string }> = [];
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Claude Code transcript format: { type: "user"|"assistant", message: { role, content } }
          const msg = entry.message;
          if (msg?.role && (msg.content || entry.type === 'user')) {
            const text = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
                : '';
            turns.push({ role: msg.role, content: text });
          }
        } catch {}
      }

      if (turns.length > 0) {
        sessions.push({
          id: file.replace('.jsonl', '').slice(0, 40),
          date: stat.mtime.toISOString().slice(0, 10),
          turns,
        });
      }
    }
  } catch (e) {
    // Directory might not exist
  }
  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Correction Extraction ──

function extractCorrections(sessions: Session[]): Correction[] {
  const corrections: Correction[] = [];

  for (const session of sessions) {
    for (const turn of session.turns) {
      if (turn.role !== 'user') continue;
      const text = stripCodeBlocks(turn.content);

      for (const pattern of CORRECTION_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const sentence = match[0].trim();
          if (sentence.length > 3 && sentence.length < 200) {
            corrections.push({
              sentence,
              sessionId: session.id,
              timestamp: session.date,
            });
          }
        }
      }
    }
  }

  return corrections;
}

// ── N-gram Mining ──

interface NGramOptions {
  minLen: number;
  maxLen: number;
  minFreq: number;
}

interface NGramResult {
  phrase: string;
  frequency: number;
  sessions: string[];
}

function extractNGrams(sessions: Session[], opts: NGramOptions): NGramResult[] {
  const phraseMap = new Map<string, { count: number; sessions: Set<string> }>();

  for (const session of sessions) {
    const userTexts = session.turns
      .filter(t => t.role === 'user' && !t.content.startsWith('{') && !t.content.startsWith('[') && t.content.length > 10)
      .map(t => stripCodeBlocks(t.content));

    const combined = userTexts.join(' ');

    // Extract meaningful word sequences (Chinese chars + meaningful words)
    const words = tokenize(combined);

    for (let n = 2; n <= 5; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phrase = words.slice(i, i + n).join('');
        const clean = phrase.replace(/[，。！？、；：""''（）\s]/g, '');

        if (clean.length < opts.minLen || clean.length > opts.maxLen) continue;
        if (/^\d+$/.test(clean)) continue;
        if (STOP_WORDS.has(clean)) continue;
        if (isPunctuation(clean)) continue;

        const existing = phraseMap.get(clean) || { count: 0, sessions: new Set() };
        existing.count++;
        existing.sessions.add(session.id);
        phraseMap.set(clean, existing);
      }
    }
  }

  // Filter by minimum frequency and sort
  return Array.from(phraseMap.entries())
    .filter(([, v]) => v.count >= opts.minFreq && v.sessions.size >= 2)
    .map(([phrase, v]) => ({ phrase, frequency: v.count, sessions: Array.from(v.sessions) }))
    .filter(r => !isCodeNoise(r.phrase) && hasSemanticContent(r.phrase))
    .sort((a, b) => b.frequency - a.frequency || b.sessions.length - a.sessions.length);
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  const CN = /[\u4e00-\u9fff\u3400-\u4dbf]/;

  for (const char of text) {
    if (CN.test(char)) {
      current += char;
    } else if (/[a-zA-Z0-9_\-/.]/.test(char)) {
      current += char;
    } else {
      pushToken(current, tokens, CN);
      current = '';
    }
  }
  pushToken(current, tokens, CN);

  return tokens;
}

function pushToken(current: string, tokens: string[], CN: RegExp): void {
  if (current.length < 2) return;
  if (CN.test(current)) {
    // Chinese: character bigrams + trigrams + the full sequence
    for (let i = 0; i <= current.length - 2; i++) {
      tokens.push(current.slice(i, i + 2));
    }
    for (let i = 0; i <= current.length - 3; i++) {
      tokens.push(current.slice(i, i + 3));
    }
    if (current.length <= 6) tokens.push(current); // keep short full sequences too
  } else {
    tokens.push(current);
  }
}

// ── Existing Rules ──

function isInExistingRules(concept: string, existingRules: Set<string>): boolean {
  const lower = concept.toLowerCase();
  if (existingRules.has(lower)) return true;
  // Partial match: concept appears in any rule name
  for (const rule of existingRules) {
    if (rule.includes(lower) || lower.includes(rule)) return true;
  }
  return false;
}

function loadExistingRules(memoryDir: string): Set<string> {
  const concepts = new Set<string>();
  try {
    if (!fs.existsSync(memoryDir)) return concepts;
    for (const file of fs.readdirSync(memoryDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
      // Extract key concepts from rule titles
      const titleMatch = content.match(/#\s+(.+)/);
      if (titleMatch) {
        const words = tokenize(titleMatch[1]);
        for (const w of words) {
          if (w.length >= 4) concepts.add(w.toLowerCase());
        }
      }
    }
  } catch {}
  return concepts;
}

// ── Candidate Generation ──

function generateCandidates(
  corrections: Correction[],
  ngrams: NGramResult[],
  existingRules: Set<string>,
): PatternCandidate[] {
  const candidates: PatternCandidate[] = [];

  // From corrections: cluster similar sentences
  const correctionClusters = clusterCorrections(corrections);
  for (const cluster of correctionClusters) {
    // Must appear at least 3 times total
    if (cluster.sentences.length < 3) continue;
    const concept = extractConcept(cluster.sentences);
    if (isInExistingRules(concept, existingRules)) continue;

    candidates.push({
      pattern: concept,
      frequency: cluster.sentences.length,
      sessions: cluster.sessions,
      source: 'correction',
      confidence: Math.min(1, cluster.sentences.length / 10),
      suggestedRule: `feedback_auto_${concept.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').slice(0, 40)}.md`,
    });
  }

  // From N-grams: high-frequency concepts not in corrections
  const correctionConcepts = new Set(correctionClusters.map(c => extractConcept(c.sentences).toLowerCase()));
  for (const ng of ngrams) {
    const concept = ng.phrase;
    if (correctionConcepts.has(concept.toLowerCase())) continue; // already covered
    if (isInExistingRules(concept, existingRules)) continue;
    if (ng.frequency < 2) continue;
    const crossSessionStrength = ng.sessions.length >= 2;
    const highFreqSingle = ng.sessions.length === 1 && ng.frequency >= 4;
    if (!crossSessionStrength && !highFreqSingle) continue;

    candidates.push({
      pattern: concept,
      frequency: ng.frequency,
      sessions: ng.sessions,
      source: 'ngram',
      confidence: Math.min(1, ng.frequency / 10),
      suggestedRule: `feedback_recurring_${concept.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').slice(0, 40)}.md`,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

interface CorrectionCluster {
  sentences: string[];
  sessions: string[];
}

function clusterCorrections(corrections: Correction[]): CorrectionCluster[] {
  const clusters: CorrectionCluster[] = [];
  const used = new Set<number>();

  for (let i = 0; i < corrections.length; i++) {
    if (used.has(i)) continue;
    const cluster: CorrectionCluster = {
      sentences: [corrections[i].sentence],
      sessions: [corrections[i].sessionId],
    };
    used.add(i);

    for (let j = i + 1; j < corrections.length; j++) {
      if (used.has(j)) continue;
      const similarity = jaccardSimilarity(corrections[i].sentence, corrections[j].sentence);
      if (similarity > 0.3) {
        cluster.sentences.push(corrections[j].sentence);
        if (!cluster.sessions.includes(corrections[j].sessionId)) {
          cluster.sessions.push(corrections[j].sessionId);
        }
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function extractConcept(sentences: string[]): string {
  // Take the longest sentence and extract the noun phrase after the correction marker
  const longest = sentences.reduce((a, b) => a.length > b.length ? a : b, '');
  // Remove correction patterns, keep the concept
  const cleaned = longest
    .replace(/你(?:又|还是)(?:在)?(?:犯|忘|没|不)/g, '')
    .replace(/我不是(?:说|让|让做|讲)[了过]?/g, '')
    .replace(/怎么(?:又|还|老)(?:是|在)?/g, '')
    .replace(/我(?:一直|反复|总是)(?:在|说|强调)?/g, '')
    .replace(/老(?:是|在|犯|忘)(?:了)?/g, '')
    .replace(/[，。！？、；：""''（）\s]+/g, '')
    .trim();

  return cleaned.slice(0, 60) || longest.slice(0, 60);
}

// ── Output ──

function printCorrectionSummary(corrections: Correction[]): void {
  if (corrections.length === 0) {
    console.log(chalk.green('No correction patterns found'));
    return;
  }

  console.log(chalk.yellow(`📢 ${corrections.length} correction signals detected\n`));
}

function printCandidates(candidates: PatternCandidate[], existingRules: Set<string>): void {
  if (candidates.length === 0) {
    console.log(chalk.green('✅ No new pattern candidates — all recurring concepts already have rules\n'));
    return;
  }

  console.log(chalk.bold('🔔 Pattern Candidates (suggested rules)\n'));

  const topK = candidates.slice(0, 10);
  for (const c of topK) {
    const icon = c.source === 'correction' ? '🔴' : '🟡';
    const confBar = '█'.repeat(Math.round(c.confidence * 10)) + '░'.repeat(10 - Math.round(c.confidence * 10));
    console.log(chalk.bold(`${icon} ${c.pattern}`));
    console.log(chalk.gray(`   Source: ${c.source} | Freq: ${c.frequency} | Sessions: ${c.sessions.length} | Confidence: ${confBar}`));
    console.log(chalk.cyan(`   → Rule: ${c.suggestedRule}`));
    console.log();
  }

  if (candidates.length > 10) {
    console.log(chalk.gray(`... and ${candidates.length - 10} more candidates. Run with --json for full list.`));
  }
}

// ── Utilities ──

function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\{[^{}]*"[^"]+"\s*:\s*"[^"]*"[^}]*\}/g, '')  // strip JSON objects
    .replace(/\[[\s\S]*?\]/g, '')  // strip JSON arrays
    .replace(/\\n/g, ' ')  // strip escaped newlines
    .replace(/[{}[\]"':,\\]+/g, ' '); // strip JSON punctuation
}

function hasSemanticContent(phrase: string): boolean {
  // Must contain Chinese characters or be a meaningful English word (≥7 chars)
  if (/[\u4e00-\u9fff]/.test(phrase)) return true;
  if (phrase.length >= 7 && /^[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z]$/.test(phrase)) return true;
  return false;
}

function isCodeNoise(phrase: string): boolean {
  // Pure Latin chars without Chinese → likely JSON/code artifact
  if (!/[\u4e00-\u9fff]/.test(phrase) && phrase.length <= 6) return true;
  // Common JSON field name fragments
  if (/^(?:clla|cood|odde|oppe|laaw|peen|enne|ennc|ddec|deco|ecod|code|type|role|name|text|file|path|tool|user|session)$/i.test(phrase)) return true;
  return false;
}

function isPunctuation(str: string): boolean {
  return /^[，。！？、；：""''（）\[\]【】「」『』《》〈〉\s]+$/.test(str);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
