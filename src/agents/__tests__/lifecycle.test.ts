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

    it('失败后应用回退策略重试', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ maxRetries: 3 }));
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed' && s.retryCount < 3,
        action: 'retry',
      });
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'error');
      expect(state!.status).toBe('running');
      expect(state!.retryCount).toBe(1);
      expect(state!.error).toBeUndefined();
    });

    it('未注册的 Agent 返回 undefined', () => {
      const lc = new AgentLifecycle();
      expect(lc.fail('unknown', 'err')).toBeUndefined();
    });

    it('未配置 maxRetries 时使用默认值 3', () => {
      const lc = new AgentLifecycle();
      // 不设置 maxRetries，触发 ?? 3 回退
      lc.register(makeConfig());
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed',
        action: 'retry',
      });
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'err');
      expect(state!.status).toBe('running');
      expect(state!.retryCount).toBe(1);
    });

    it('达到最大重试次数后不再重试', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ maxRetries: 1 }));
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed' && s.retryCount < 1,
        action: 'retry',
      });
      lc.start('agent-1');
      lc.fail('agent-1', 'err1'); // retry → running
      lc.fail('agent-1', 'err2'); // no retry, stays failed
      const state = lc.getState('agent-1');
      expect(state!.status).toBe('failed');
    });

    it('degrade 策略将状态设为 paused', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed',
        action: 'degrade',
      });
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'err');
      expect(state!.status).toBe('paused');
      expect(state!.metadata.degraded).toBe(true);
    });

    it('abort 策略将状态设为 terminated', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed',
        action: 'abort',
      });
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'err');
      expect(state!.status).toBe('terminated');
    });

    it('notify 策略不改变状态', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.addFallbackStrategy({
        condition: (s) => s.status === 'failed',
        action: 'notify',
      });
      lc.start('agent-1');
      const state = lc.fail('agent-1', 'err');
      expect(state!.status).toBe('failed');
    });
  });

  describe('terminate', () => {
    it('终止 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      lc.start('agent-1');
      const state = lc.terminate('agent-1');
      expect(state!.status).toBe('terminated');
      expect(state!.completedAt).toBeTruthy();
    });

    it('终止未注册的 Agent 返回 undefined', () => {
      const lc = new AgentLifecycle();
      expect(lc.terminate('unknown')).toBeUndefined();
    });
  });

  describe('getState / getByStatus', () => {
    it('获取指定 Agent 状态', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      const state = lc.getState('agent-1');
      expect(state).toBeDefined();
      expect(state!.id).toBe('agent-1');
    });

    it('按状态过滤', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ id: 'a1' }));
      lc.register(makeConfig({ id: 'a2' }));
      lc.start('a1');
      expect(lc.getByStatus('running')).toHaveLength(1);
      expect(lc.getByStatus('idle')).toHaveLength(1);
    });
  });

  describe('事件', () => {
    it('start 触发事件', () => {
      const lc = new AgentLifecycle();
      const events: any[] = [];
      lc.onEvent((e) => events.push(e));
      lc.register(makeConfig());
      lc.start('agent-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('start');
    });

    it('complete 触发事件', () => {
      const lc = new AgentLifecycle();
      const events: any[] = [];
      lc.onEvent((e) => events.push(e));
      lc.register(makeConfig());
      lc.start('agent-1');
      lc.complete('agent-1');
      expect(events.some(e => e.type === 'complete')).toBe(true);
    });

    it('fail 触发 error 事件', () => {
      const lc = new AgentLifecycle();
      const events: any[] = [];
      lc.onEvent((e) => events.push(e));
      lc.register(makeConfig());
      lc.start('agent-1');
      lc.fail('agent-1', 'err');
      expect(events.some(e => e.type === 'error')).toBe(true);
    });

    it('事件处理器异常不影响主流程', () => {
      const lc = new AgentLifecycle();
      lc.onEvent(() => { throw new Error('handler error'); });
      lc.register(makeConfig());
      expect(() => lc.start('agent-1')).not.toThrow();
    });
  });

  describe('remove / clear', () => {
    it('remove 移除 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig());
      expect(lc.remove('agent-1')).toBe(true);
      expect(lc.getState('agent-1')).toBeUndefined();
    });

    it('clear 清空所有 Agent', () => {
      const lc = new AgentLifecycle();
      lc.register(makeConfig({ id: 'a1' }));
      lc.register(makeConfig({ id: 'a2' }));
      lc.clear();
      expect(lc.getAllStates()).toHaveLength(0);
    });
  });
});
