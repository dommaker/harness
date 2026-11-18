/**
 * acceptance list 与 SpecAcceptanceGate 共享 parseTasksFile 单一契约（D5）
 *
 * 钉住三条（全部经公开入口观察：gate.check() / listAcceptanceCriteria()）：
 * 1. 同一份合法 tasks.yml，gate 接受的任务与验收条件，list 列出相同内容
 *    （不一边接受一边忽略或解释不同）。
 * 2. checked:true / 未勾选带 e2e_test / 未勾选无 e2e_test 三种判定语义在两入口
 *    都有区分、不被静默丢弃（gate 判定语义由 gates 层测试钉，这里钉 list 展示
 *    不丢条件 + gate 判负结论与 list 展示的未勾选项一致）。
 * 3. 非法 YAML / 非法顶层形状 / 非法任务或验收条件：gate 抛出（fail-fast），
 *    list 返回 kind:'fail'（bin 退出 1），不再静默 skip。
 *
 * 全部用真实 fs：每轮唯一 fs.mkdtempSync 夹具 + 清理，不 mock IO。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpecAcceptanceGate } from '../../../gates/acceptance';
import { captureIO, type CapturingIO } from '../../command-contract';
import { listAcceptanceCriteria } from '../acceptance';

describe('acceptance list 单一解析契约（D5）', () => {
  let tempDir: string;
  let io: CapturingIO;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd5-list-'));
    io = captureIO();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTasks(content: string, rel = 'tasks.yml'): void {
    const file = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }

  const VALID_YML = [
    'tasks:',
    '  - id: TASK-001',
    '    title: 任务一',
    '    completed: true',
    '    acceptance:',
    '      - description: 条件 A（人工已核）',
    '        checked: true',
    '      - description: 条件 B（e2e 覆盖）',
    '        checked: true',
    '        e2e_test: tests/b.spec.ts',
    '        test_name: should B',
    '  - id: TASK-002',
    '    acceptance:',
    '      - description: 条件 C',
    '        checked: true',
    '',
  ].join('\n');

  it('同一合法 tasks.yml：gate 实际消费两个任务三条条件，list 列出相同任务数/条件数', async () => {
    writeTasks(VALID_YML);

    // 公开入口一：gate 消费同一份文件。已知字面量：VALID_YML = TASK-001 两条 +
    // TASK-002 一条，共 3 条且全部勾选——details 计数证明 gate 没漏条件。
    const gate = new SpecAcceptanceGate({ checkAllTasks: true });
    const gateResult = await gate.check({ projectPath: tempDir });
    expect(gateResult.passed).toBe(true);
    expect(gateResult.details?.totalCriteria).toBe(3);
    expect(gateResult.details?.checkedCriteria).toBe(3);

    // 单任务视角再证一次：两个任务各自被消费（2 条 + 1 条，逐字已知量）
    const task1 = await gate.check({ projectPath: tempDir, taskId: 'TASK-001' });
    expect(task1.details).toEqual(
      expect.objectContaining({ taskId: 'TASK-001', totalCriteria: 2, checkedCriteria: 2 }),
    );
    const task2 = await gate.check({ projectPath: tempDir, taskId: 'TASK-002' });
    expect(task2.details).toEqual(
      expect.objectContaining({ taskId: 'TASK-002', totalCriteria: 1, checkedCriteria: 1 }),
    );

    // 公开入口二：list 必须列出相同的任务数与条件数（按输出结构计数，期望值为
    // 上面钉死的字面量 2/3，不从被测实现推导）
    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result).toEqual({ kind: 'ok' });

    const out = io.outText();
    const taskHeaders = out.split('\n').filter(l => /^TASK-\d+:$/.test(l));
    const criteriaLines = out.split('\n').filter(l => /^\s+\d+\.\s/.test(l));
    expect(taskHeaders).toEqual(['TASK-001:', 'TASK-002:']);
    expect(criteriaLines).toHaveLength(3);
    expect(criteriaLines.filter(l => l.includes('[✓]'))).toHaveLength(3);

    // 已知字面量的内容断言（含 e2e/test_name 标注）
    for (const expected of [
      '条件 A（人工已核）',
      '条件 B（e2e 覆盖）',
      '条件 C',
      'e2e: tests/b.spec.ts, -g should B',
    ]) {
      expect(out).toContain(expected);
    }
    // list 列出的条件数与 gate 消费的条件数一致
    expect(criteriaLines.length).toBe(gateResult.details?.totalCriteria);
  });

  it('三种判定语义不丢：checked:true / 未勾选带 e2e_test / 未勾选无 e2e_test', async () => {
    writeTasks([
      'tasks:',
      '  - id: TASK-001',
      '    acceptance:',
      '      - description: 已勾选条件',
      '        checked: true',
      '      - description: 待 e2e 条件',
      '        checked: false',
      '        e2e_test: tests/pending.spec.ts',
      '      - description: 待人工条件',
      '        checked: false',
      '',
    ].join('\n'));

    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result).toEqual({ kind: 'ok' });
    const out = io.outText();
    // 三种条件都在列表里，且勾选状态有区分
    expect(out).toContain('[✓] 已勾选条件');
    expect(out).toContain('[ ] 待 e2e 条件 (e2e: tests/pending.spec.ts)');
    expect(out).toContain('[ ] 待人工条件');

    // gate 侧判定语义不变：两个未勾选条件 → 判负（e2e 分支用速败命令避免真跑
    // playwright），且未勾选项与 list 展示一致
    const gate = new SpecAcceptanceGate({ e2eTestCommand: 'false' });
    const gateResult = await gate.check({ projectPath: tempDir, taskId: 'TASK-001' });
    expect(gateResult.passed).toBe(false);
    expect(gateResult.details?.uncheckedCriteria).toEqual(['待 e2e 条件', '待人工条件']);
  });

  it('非法 YAML：gate 抛出，list 返回 fail 且输出明确错误（不再静默 skip）', async () => {
    writeTasks('invalid: yaml: content: [');

    await expect(
      new SpecAcceptanceGate().check({ projectPath: tempDir }),
    ).rejects.toThrow();

    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result.kind).toBe('fail');
    expect(result).toHaveProperty('reason');
    expect(io.outText()).not.toContain('未找到任务定义');
  });

  it('非法顶层形状（缺 tasks 数组）：两入口一致 fail-fast，list 非 skip', async () => {
    writeTasks('version: "1"\nfoo: bar\n');

    await expect(
      new SpecAcceptanceGate().check({ projectPath: tempDir }),
    ).rejects.toThrow('tasks.yml 格式非法');

    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result.kind).toBe('fail');
    expect(io.outText()).toContain('tasks.yml 格式非法');
  });

  it('非法任务 / 非法验收条件：两入口一致失败', async () => {
    writeTasks('tasks:\n  - description: 缺 id\n');

    await expect(
      new SpecAcceptanceGate().check({ projectPath: tempDir }),
    ).rejects.toThrow('缺 id');

    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result.kind).toBe('fail');

    writeTasks('tasks:\n  - id: TASK-001\n    acceptance:\n      - checked: true\n');
    await expect(
      new SpecAcceptanceGate().check({ projectPath: tempDir }),
    ).rejects.toThrow('acceptance[0] 缺 description');
    expect((await listAcceptanceCriteria({ projectPath: tempDir }, io)).kind).toBe('fail');
  });

  it('--tasks-path 相对路径锚 projectPath，与 gate 指向同一份文件', async () => {
    writeTasks(VALID_YML, 'config/tasks.yml');

    const gate = new SpecAcceptanceGate({ tasksPath: 'config/tasks.yml', checkAllTasks: true });
    expect((await gate.check({ projectPath: tempDir })).passed).toBe(true);

    const result = await listAcceptanceCriteria(
      { projectPath: tempDir, tasksPath: 'config/tasks.yml' },
      io,
    );
    expect(result).toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('TASK-001:');
  });

  it('tasks.yml 不在场：与 gate「无文件即跳过」语义一致 → kind:skip', async () => {
    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result.kind).toBe('skip');
  });

  it('tasks: 空数组解析合法：gate 判「无任务即过」，list 返回 ok 非 skip', async () => {
    writeTasks('tasks: []\n');

    const gateResult = await new SpecAcceptanceGate().check({ projectPath: tempDir });
    expect(gateResult.passed).toBe(true);

    const result = await listAcceptanceCriteria({ projectPath: tempDir }, io);
    expect(result).toEqual({ kind: 'ok' });
  });
});
