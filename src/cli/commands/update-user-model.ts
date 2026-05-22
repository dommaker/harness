/**
 * harness update-user-model — 用户模型持续演化引擎
 *
 * 不依赖固定规则快照。每天从最新数据中提取增量信号，
 * 对比昨天状态，输出变化，更新模型。
 *
 * 数据源:
 *   ~/.claude/projects/-root--claude/*.jsonl  (对话)
 *   /tmp/claude-knowledge-hooks.log            (行为信号)
 *   studio/.harness/knowledge/                 (知识新鲜度)
 *   ~/.claude/projects/-root-projects/memory/  (规则库)
 *
 * 模型状态: ~/.claude/user-model-state.json
 * 画像输出: ~/.claude/projects/-root-projects/memory/user_profile.md
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface UpdateUserModelOptions {
  json?: boolean;
  dryRun?: boolean;  // don't update state, just show what would change
}

interface ModelState {
  lastUpdated: string;
  sessionsProcessed: string[];       // session IDs already counted
  patterns: Record<string, {         // pattern → running stats
    firstSeen: string;
    occurrences: number;
    sessions: string[];
    trend: 'rising' | 'stable' | 'falling' | 'new' | 'gone';
    lastSeen: string;
  }>;
  lensWeights: Record<string, number>;  // lens → activation count → normalized weight
  principleWeights: Record<string, number>;
  evolutionLog: Array<{ date: string; change: string }>;
}

const STATE_FILE = path.join(os.homedir(), '.claude', 'user-model-state.json');
const PROFILE_FILE = path.join(os.homedir(), '.claude', 'projects', '-root-projects', 'memory', 'user_profile.md');

export async function updateUserModel(options: UpdateUserModelOptions): Promise<void> {
  const transcriptDir = process.env.CLAUDE_TRANSCRIPTS_DIR
    || path.join(os.homedir(), '.claude', 'projects', '-root--claude');

  // 1. Load previous state
  const state = loadState();

  // 2. Scan new data
  const newSessions = findNewSessions(transcriptDir, state.sessionsProcessed);
  if (newSessions.length === 0) {
    console.log(chalk.gray('No new sessions to process'));
    return;
  }

  // 3. Extract signals from new data
  const signals = extractSignals(newSessions);

  // 4. Diff against previous state → find changes
  const changes = diffState(state, signals);

  // 5. Update state
  if (!options.dryRun) {
    for (const sid of newSessions.map(s => s.id)) {
      if (!state.sessionsProcessed.includes(sid)) {
        state.sessionsProcessed.push(sid);
      }
    }
    applySignals(state, signals);
    state.lastUpdated = new Date().toISOString();

    if (state.sessionsProcessed.length > 200) {
      state.sessionsProcessed = state.sessionsProcessed.slice(-200);
    }

    saveState(state);
    updateProfile(state);
  }

  // 6. Output
  if (options.json) {
    console.log(JSON.stringify({ newSessions: newSessions.length, changes }, null, 2));
    return;
  }

  console.log(chalk.blue(`📊 Processed ${newSessions.length} new sessions\n`));
  printChanges(changes, signals);
}

// ── State I/O ──

function loadState(): ModelState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return {
    lastUpdated: new Date(0).toISOString(),
    sessionsProcessed: [],
    patterns: {},
    lensWeights: {},
    principleWeights: {},
    evolutionLog: [],
  };
}

function saveState(state: ModelState): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {}
}

// ── Session scanning ──

interface SimpleSession {
  id: string;
  date: string;
  userText: string;       // all user messages joined
  assistantText: string;  // all assistant messages joined
  toolCalls: string[];     // tool names used
}

function findNewSessions(dir: string, processed: string[]): SimpleSession[] {
  const sessions: SimpleSession[] = [];
  try {
    if (!fs.existsSync(dir)) return [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace('.jsonl', '');
      if (processed.includes(sessionId)) continue;

      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const turns: Array<{ role: string; content: string }> = [];
      const toolCalls: string[] = [];

      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const msg = entry.message;
          if (msg?.role && msg.content) {
            const text = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
                : '';
            turns.push({ role: msg.role, content: text });
          }
          // Track tool calls from assistant messages
          if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use' && block.name) {
                toolCalls.push(block.name);
              }
            }
          }
        } catch {}
      }

      if (turns.length > 0) {
        sessions.push({
          id: sessionId.slice(0, 40),
          date: stat.mtime.toISOString().slice(0, 10),
          userText: turns.filter(t => t.role === 'user').map(t => t.content).join('\n'),
          assistantText: turns.filter(t => t.role === 'assistant').map(t => t.content).join('\n'),
          toolCalls: [...new Set(toolCalls)],
        });
      }
    }
  } catch {}
  return sessions.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Signal extraction ──

interface SessionSignals {
  sessionId: string;
  date: string;
  correctionPhrases: string[];        // "你又..." etc.
  concepts: Record<string, number>;   // N-gram → frequency
  toolPatterns: Record<string, number>; // tool → count
  sessionDuration: number;            // estimated from turn count
  turnCount: number;
  deepAnalysis: boolean;              // EnterPlanMode or Agent(Explore)
  knowledgeCaptured: boolean;         // Write to knowledge-docs
}

function extractSignals(sessions: SimpleSession[]): SessionSignals[] {
  return sessions.map(s => {
    // Correction detection
    const correctionPatterns = [
      /你(?:又|还是)(?:在)?(?:犯|忘|没|不).{0,30}?[了]?/g,
      /我不是(?:说|让|让做|讲)[了过]?.{0,50}?[了吗?？]?/g,
      /怎么(?:又|还|老)(?:是|在)?.{0,30}?[了]?/g,
      /我(?:一直|反复|总是)(?:在|说|强调)?.{0,30}?[了]?/g,
    ];
    const correctionPhrases: string[] = [];
    for (const pat of correctionPatterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(s.userText)) !== null) {
        correctionPhrases.push(m[0].trim());
      }
    }

    // Concept extraction (Chinese char N-grams, ≥4 char)
    const concepts: Record<string, number> = {};
    const cleanText = s.userText
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\{[^{}]*\}/g, '')
      .replace(/[{}[\]"':,\\]+/g, ' ');
    let cnSeq = '';
    for (const char of cleanText) {
      if (/[\u4e00-\u9fff]/.test(char)) {
        cnSeq += char;
      } else {
        if (cnSeq.length >= 4) concepts[cnSeq] = (concepts[cnSeq] || 0) + 1;
        cnSeq = '';
      }
    }
    if (cnSeq.length >= 4) concepts[cnSeq] = (concepts[cnSeq] || 0) + 1;

    // Tool patterns
    const toolPatterns: Record<string, number> = {};
    for (const t of s.toolCalls) {
      toolPatterns[t] = (toolPatterns[t] || 0) + 1;
    }

    return {
      sessionId: s.id,
      date: s.date,
      correctionPhrases,
      concepts,
      toolPatterns,
      sessionDuration: s.userText.length + s.assistantText.length, // proxy
      turnCount: (s.userText.match(/\n/g) || []).length,
      deepAnalysis: s.toolCalls.includes('EnterPlanMode') || s.toolCalls.includes('Agent'),
      knowledgeCaptured: s.toolCalls.includes('Write') && (
        s.assistantText.includes('.harness/knowledge-docs/') ||
        s.assistantText.includes('.harness/knowledge/')
      ),
    };
  });
}

// ── Diff & Apply ──

interface Change {
  type: 'new_pattern' | 'rising' | 'falling' | 'gone' | 'lens_shift';
  key: string;
  detail: string;
}

function diffState(state: ModelState, signals: SessionSignals[]): Change[] {
  const changes: Change[] = [];

  // Aggregate concepts across all new sessions
  const conceptAgg: Record<string, { count: number; sessions: string[] }> = {};
  for (const sig of signals) {
    for (const [concept, count] of Object.entries(sig.concepts)) {
      if (!conceptAgg[concept]) conceptAgg[concept] = { count: 0, sessions: [] };
      conceptAgg[concept].count += count;
      if (!conceptAgg[concept].sessions.includes(sig.sessionId)) {
        conceptAgg[concept].sessions.push(sig.sessionId);
      }
    }
  }

  // Detect new/rising/falling/gone concepts
  for (const [concept, agg] of Object.entries(conceptAgg)) {
    const existing = state.patterns[concept];
    if (!existing) {
      if (agg.sessions.length >= 2) {
        changes.push({ type: 'new_pattern', key: concept, detail: `Appeared in ${agg.sessions.length} sessions` });
      }
    } else if (existing.trend === 'gone' || existing.trend === 'falling') {
      changes.push({ type: 'rising', key: concept, detail: `Re-emerged after being ${existing.trend}` });
    }
  }

  // Detect lens weight shifts (from correction patterns)
  const totalCorrections = signals.reduce((sum, s) => sum + s.correctionPhrases.length, 0);
  if (totalCorrections >= 3) {
    changes.push({ type: 'lens_shift', key: 'completeness',
      detail: `${totalCorrections} corrections in these sessions — completeness lens may need weight increase` });
  }

  return changes;
}

function applySignals(state: ModelState, signals: SessionSignals[]): void {
  const now = new Date().toISOString().slice(0, 10);

  // Update patterns from concepts
  for (const sig of signals) {
    for (const [concept, count] of Object.entries(sig.concepts)) {
      if (!state.patterns[concept]) {
        state.patterns[concept] = {
          firstSeen: now,
          occurrences: 0,
          sessions: [],
          trend: 'new',
          lastSeen: now,
        };
      }
      const p = state.patterns[concept];
      p.occurrences += count;
      if (!p.sessions.includes(sig.sessionId)) p.sessions.push(sig.sessionId);
      p.lastSeen = now;
      p.trend = p.occurrences >= 5 ? 'stable' : 'rising';
    }
  }

  // Update lens weights from correction signals
  for (const sig of signals) {
    if (sig.correctionPhrases.length > 0) {
      state.lensWeights.completeness = (state.lensWeights.completeness || 0) + 1;
      state.lensWeights.automation = (state.lensWeights.automation || 0) + (sig.correctionPhrases.length > 2 ? 1 : 0);
    }
    if (sig.deepAnalysis) {
      state.lensWeights.first_principles = (state.lensWeights.first_principles || 0) + 1;
    }
  }

  // Detect falling/stable shifts
  for (const [key, p] of Object.entries(state.patterns)) {
    if (p.trend === 'stable' && p.lastSeen < new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)) {
      p.trend = 'falling';
    }
  }
}

// ── Profile update ──

function updateProfile(state: ModelState): void {
  try {
    let content = fs.readFileSync(PROFILE_FILE, 'utf-8');

    // Replace Derived Rules section
    const derivedStart = '## Derived Rules';
    const derivedEnd = '\n## Evolution';
    const derivedIdx = content.indexOf(derivedStart);

    const activePatterns = Object.entries(state.patterns)
      .filter(([, p]) => (p.trend === 'rising' || p.trend === 'stable') && p.sessions.length >= 2)
      .sort(([, a], [, b]) => b.occurrences - a.occurrences)
      .slice(0, 10);

    const derivedContent = [
      '## Derived Rules (auto-generated by update-user-model)',
      `Last scan: ${state.lastUpdated}. ${state.sessionsProcessed.length} sessions analyzed.`,
      '',
      '| Pattern | Trend | Occurrences | Sessions |',
      '|---------|-------|-------------|----------|',
      ...activePatterns.map(([k, p]) =>
        `| ${k} | ${p.trend} | ${p.occurrences} | ${p.sessions.length} |`),
      '',
    ].join('\n');

    if (derivedIdx >= 0) {
      content = content.slice(0, derivedIdx) + derivedContent + '\n' + content.slice(content.indexOf(derivedEnd, derivedIdx));
    } else {
      // No derived section yet — append before Evolution
      const evIdx = content.indexOf('## Evolution');
      if (evIdx >= 0) {
        content = content.slice(0, evIdx) + derivedContent + '\n' + content.slice(evIdx);
      } else {
        content += '\n' + derivedContent;
      }
    }

    fs.writeFileSync(PROFILE_FILE, content, 'utf-8');
  } catch (e) {
    // Profile file might not exist yet — skip
  }
}

// ── Output ──

function printChanges(changes: Change[], signals: SessionSignals[]): void {
  if (changes.length === 0) {
    console.log(chalk.green('No significant changes detected'));
    return;
  }

  const byType = {
    new_pattern: changes.filter(c => c.type === 'new_pattern'),
    rising: changes.filter(c => c.type === 'rising'),
    lens_shift: changes.filter(c => c.type === 'lens_shift'),
  };

  if (byType.new_pattern.length > 0) {
    console.log(chalk.yellow(`🌱 New patterns: ${byType.new_pattern.length}`));
    for (const c of byType.new_pattern.slice(0, 5)) {
      console.log(chalk.gray(`   ${c.key}: ${c.detail}`));
    }
    console.log();
  }

  if (byType.rising.length > 0) {
    console.log(chalk.green(`📈 Re-emerging: ${byType.rising.length}`));
    for (const c of byType.rising.slice(0, 5)) {
      console.log(chalk.gray(`   ${c.key}: ${c.detail}`));
    }
    console.log();
  }

  if (byType.lens_shift.length > 0) {
    console.log(chalk.cyan(`🎯 Lens shifts:`));
    for (const c of byType.lens_shift) {
      console.log(chalk.gray(`   ${c.key}: ${c.detail}`));
    }
    console.log();
  }

  console.log(chalk.bold(`Total signals processed:`));
  console.log(`  Sessions: ${signals.length}`);
  console.log(`  Correction phrases: ${signals.reduce((s, sig) => s + sig.correctionPhrases.length, 0)}`);
  console.log(`  Concepts extracted: ${signals.reduce((s, sig) => s + Object.keys(sig.concepts).length, 0)}`);
}
