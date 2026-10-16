/**
 * knowledge list/import 枚举旗帜白名单校验（重构班次 3 Phase 5）
 *
 * 原 `split(',') as Xxx[]` 强转不校验，非法值静默进 filter/导入面；
 * 现非法值在命令入口即 usage-error（CommandResult 契约，不触 store）。
 */

import { knowledgeList } from '../knowledge/list';
import { knowledgeImport } from '../knowledge/import';
import { captureIO } from '../../command-contract';

describe('knowledge list 枚举白名单', () => {
  it('--type 非法值 → usage-error 并点名非法值与可用集', async () => {
    const r = await knowledgeList({ type: 'model,bogus' }, captureIO());
    expect(r).toEqual({
      kind: 'usage-error',
      reason: expect.stringContaining('--type 非法值: bogus'),
    });
  });

  it('--maturity 非法值 → usage-error', async () => {
    const r = await knowledgeList({ maturity: 'draft,eternal' }, captureIO());
    expect(r).toEqual({
      kind: 'usage-error',
      reason: expect.stringContaining('--maturity 非法值: eternal'),
    });
  });

  it('全部合法 → 不走 usage-error（穿透到取数路径）', async () => {
    const io = captureIO();
    const r = await knowledgeList({ type: 'model,decision', maturity: 'draft' }, io);
    // 合法输入会继续取数（真实库或空库），只断言不被白名单拦下
    expect(r.kind).not.toBe('usage-error');
  });
});

describe('knowledge import --sources 白名单', () => {
  it('非法 source → usage-error 并点名', async () => {
    const r = await knowledgeImport({ sources: 'code,nonsense' }, captureIO());
    expect(r).toEqual({
      kind: 'usage-error',
      reason: expect.stringContaining('--sources 非法值: nonsense'),
    });
  });
});
