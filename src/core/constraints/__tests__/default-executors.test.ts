/**
 * default-executors 注册测试
 */

import { constraintInterceptor } from '../interceptor';

describe('registerDefaultExecutors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton state for clean test
    (constraintInterceptor as any).executors.clear();
    (constraintInterceptor as any).executorSources.clear();
  });

  it('应该注册 architecture-check executor', async () => {
    const { registerDefaultExecutors } = await import('../default-executors');
    registerDefaultExecutors();

    expect(constraintInterceptor.hasExecutor('architecture-check')).toBe(true);
  });

  it('应该注册 cross-project-check executor', async () => {
    const { registerDefaultExecutors } = await import('../default-executors');
    registerDefaultExecutors();

    expect(constraintInterceptor.hasExecutor('cross-project-check')).toBe(true);
  });

  it('架构检查 executor 应有描述', async () => {
    const { registerDefaultExecutors } = await import('../default-executors');
    registerDefaultExecutors();

    const executor = constraintInterceptor.getExecutor('architecture-check');
    expect(executor?.description).toBeDefined();
    expect(executor?.description).toContain('架构');
  });

  it('跨工程检查 executor 应有描述', async () => {
    const { registerDefaultExecutors } = await import('../default-executors');
    registerDefaultExecutors();

    const executor = constraintInterceptor.getExecutor('cross-project-check');
    expect(executor?.description).toBeDefined();
    expect(executor?.description).toContain('跨工程');
  });

  it('重复注册应该覆盖', async () => {
    const { registerDefaultExecutors } = await import('../default-executors');
    registerDefaultExecutors();
    registerDefaultExecutors(); // Second call

    const registrations = constraintInterceptor.getRegistrations();
    const archRegs = registrations.filter(r => r.id === 'architecture-check');
    // Should only have one registration (last one wins)
    expect(archRegs.length).toBe(1);
  });
});
