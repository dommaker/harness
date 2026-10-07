import { AgentLifecycle } from '../lifecycle';
import type { AgentConfig } from '../types';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    workingDir: '/tmp',
    ...overrides,
  };
}

describe('AgentLifecycle', () => {
  describe('register', () => {
    it('注册 Agent 返回 idle 状态', () => {
      const lc = new AgentLifecycle();
      const state = lc.register(makeConfig());
      expect(state.id).toBe('agent-1');
      expect(state.status).toBe('idle');
      expect(state.retryCount).toBe(0);
    });

    it('注册多个 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ id: 'a1' }));
      lc.register(makeConfig({ id: 'a2' }));
      expect(lc.getAllStates()).toHaveLength(2);
    });
  });

  describe('start', () => {
    it('启动已注册的 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      const state = lc.start('agent-1');
      expect(state!.status).toBe('running');
      expect(state!.startedAt).toBeTruthy();
    });

    it('启动未注册的 Agent 返回 undefined', () => {
      const lc = new AgentLifecycle();
      expect(lc.start('unknown')).toBeUndefined();
    });
  });

  describe('complete', () => {
    it('完成 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.start('agent-1');
      const state = lc.complete('agent-1', { result: 'ok' });
      expect(state!.status).toBe('completed');
      expect(state!.completedAt).toBeTruthy();
      expect(state!.metadata.result).toBe('ok');
    });

    it('完成未注册的 Agent 返回 undefined', () => {
      const lc = new AgentLifecycle();
      expect(lc.complete('unknown')).toBeUndefined();
    });
  });

  describe('fail', () => {
    it('标记 Agent 失败', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'boom');
      expect(state!.status).toBe('failed');
      expect(state!.error).toBe('boom');
    });

    it('未注册的 Agent 返回 undefined', () => {
      const lc = new AgentLifecycle();
      expect(lc.fail('unknown', 'err')).toBeUndefined();
    });
  });

  describe('getState / getAllStates', () => {
    it('获取指定 Agent 状态', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      const state = lc.getState('agent-1');
      expect(state).toBeDefined();
      expect(state!.id).toBe('agent-1');
    });

    it('获取全部状态', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ id: 'a1' }));
      lc.register(makeConfig({ id: 'a2' }));
      lc.start('a1');
      expect(lc.getAllStates()).toHaveLength(2);
      expect(lc.getAllStates().filter(s => s.status === 'running')).toHaveLength(1);
    });
  });
});
