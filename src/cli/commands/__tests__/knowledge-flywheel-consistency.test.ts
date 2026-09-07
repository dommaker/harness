/**
 * 飞轮指标三处一致性（harness#81）
 *
 * 同一 fixture 分别走 audit D6 / knowledge stats / knowledge health 三条消费路径，
 * 断言 refCoverage / avgRefs / consumptionHitRate 逐字段相等——分子只有一份实现
 * （knowledge/flywheel-metrics），展示层各自做单位与字段名映射。
 *
 * fixture 条目全为非 archived / 非 deprecated，三处人口重合：health 的 excludeArchived
 * 切片与 audit/stats 的 active 过滤在这里是同一集合（差异在人口筛选，不在计算）。
 * 期望值即口径哨兵：修复前 stats/health 直接数 referencedBy.length，
 * 同一 fixture 会报 refCoverage 75 / avgRefs 1.5。
 */

import * as fs from 'fs';
import { captureIO, lastJsonOutput, type CapturingIO } from '../../command-contract';
import * as os from 'os';
import * as path from 'path';
import { FileKnowledgeStore } from '../../../knowledge/store';
import { KnowledgeAudit } from '../../../knowledge/audit';
import { knowledgeHealth, knowledgeStats } from '../knowledge';
import type { KnowledgeEntry } from '../../../knowledge/types';

function makeEntry(id: string, maturity: KnowledgeEntry['maturity'], referencedBy: string[]): KnowledgeEntry {
  return {
    id,
    type: 'guideline',
    title: `consistency fixture ${id}`,
    content: 'content long enough to stay out of the short-content rule and the audit filters',
    maturity,
    layer: 'project',
    created: '2026-09-01T00:00:00.000Z',
    lastReferenced: '2026-09-01T00:00:00.000Z',
    contributors: ['human'],
    projects: ['harness'],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy,
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
  };
}

/**
 * 4 条 active 条目，genuine 引用共 3 条：
 * - 2 条有真实引用（K-001 / K-004）→ refCoverage 0.5
 * - K-002 只有自动化引用（prompt-inject / test-agent / monitor），不给条目续命
 * - dailyEvents 2 / 4 条目 → consumptionHitRate 0.5
 */
const FIXTURE: KnowledgeEntry[] = [
  makeEntry('K-001', 'verified', ['agent-a:2026-09-01', 'search:2026-09-01']),
  makeEntry('K-002', 'verified', ['prompt-inject:2026-08-30', 'test-agent:2026-08-31', 'monitor:2026-09-01']),
  makeEntry('K-003', 'draft', []),
  makeEntry('K-004', 'proven', ['decision-1:2026-07-01', 'studio-web:2026-07-02']),
];

function setupKnowledgeBase(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flywheel-consistency-'));
  const baseDir = path.join(projectRoot, '.harness', 'knowledge');
  const store = new FileKnowledgeStore({ baseDir });
  for (const entry of FIXTURE) store.save(entry);
  fs.writeFileSync(
    path.join(baseDir, '.consumption-stats.json'),
    JSON.stringify({ date: '2026-09-02', dailyEvents: 2, searchHits: 1 }),
  );
  return projectRoot;
}

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('飞轮指标三处同源', () => {
  it('audit D6 / stats / health 报出同一组数字', async () => {
    const projectRoot = setupKnowledgeBase();
    const baseDir = path.join(projectRoot, '.harness', 'knowledge');

    const report = new KnowledgeAudit({ baseDir }).run();
    const auditDetails = report.dimensions.flywheel.details;
    await knowledgeStats({ projectPath: projectRoot, json: true }, io);
    const statsFlywheel = lastJsonOutput<any>(io).flywheel;

    io = captureIO();
    await knowledgeHealth({ dir: baseDir, json: true }, io);
    const healthSummary = lastJsonOutput<any>(io).summary;

    // 逐字段一致（avgRefs 在 audit 报告层的呈现名是 avgRefCount）
    expect(statsFlywheel.refCoverage).toBe(auditDetails.refCoverage);
    expect(statsFlywheel.avgRefs).toBe(auditDetails.avgRefCount);
    expect(healthSummary.refCoverage).toBe(auditDetails.refCoverage);
    expect(healthSummary.avgRefs).toBe(auditDetails.avgRefCount);
    expect(statsFlywheel.consumptionHitRate).toBe(auditDetails.consumptionHitRate);

    // canonical 值（genuine 口径）：人口 4、有引用 2、genuine 引用 3、dailyEvents 2
    expect(auditDetails).toMatchObject({
      activeEntries: 4,
      entriesWithRefs: 2,
      refCoverage: 50,
      avgRefCount: 0.8,
      dailyConsumptionEvents: 2,
      consumptionHitRate: 50,
    });
    expect(statsFlywheel).toEqual({ refCoverage: 50, avgRefs: 0.8, consumptionHitRate: 50 });
    expect(healthSummary).toMatchObject({ total: 4, refCoverage: 50, avgRefs: 0.8 });
  });
});
