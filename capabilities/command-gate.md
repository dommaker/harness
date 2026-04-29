# CommandGate - 命令门禁

> 防止 Agent 执行危险命令的三级黑名单系统

---

## 概述

CommandGate 是 harness 的第 8 个门禁，用于在 Agent 执行命令前进行安全检查，防止执行破坏性操作。

---

## 三级黑名单

| 级别 | 行为 | 适用场景 |
|:----:|------|----------|
| **block** | 禁止执行，抛错 | 系统级破坏命令 |
| **warn** | 允许执行，记录警告 | 需要确认的操作 |
| **audit** | 允许执行，静默记录 | 敏感信息访问 |

---

## 黑名单类别（8 类）

### 1. system - 系统级破坏

| ID | 模式 | 说明 |
|----|------|------|
| `rm-rf-root` | `rm -rf /` | 删除根目录 |
| `rm-rf-star` | `rm -rf *` | 通配符删除 |
| `rm-rf-home` | `rm -rf ~` | 删除用户目录 |
| `rm-rf-project` | `rm -rf .` | 删除当前目录 |

### 2. database - 数据库危险操作

| ID | 模式 | 说明 |
|----|------|------|
| `drop-database` | `DROP DATABASE` | 删除数据库 |
| `drop-table` | `DROP TABLE` | 删除表（warn）|
| `truncate-table` | `TRUNCATE TABLE` | 清空表（warn）|
| `delete-all` | `DELETE FROM ...` (无 WHERE) | 无条件删除 |

### 3. permission - 权限相关

| ID | 模式 | 说明 |
|----|------|------|
| `chmod-777` | `chmod 777` | 设置 777 权限 |
| `chown-root` | `chown root` | 修改所有者为 root（warn）|

### 4. network - 网络安全

| ID | 模式 | 说明 |
|----|------|------|
| `iptables-flush` | `iptables -F` | 清空防火墙规则 |
| `curl-bash` | `curl ... | bash` | 网络脚本执行 |
| `wget-bash` | `wget ... | bash` | 网络脚本执行 |

### 5. privilege - 特权命令

| ID | 模式 | 说明 |
|----|------|------|
| `sudo-rm` | `sudo rm` | sudo 删除 |
| `sudo-dd` | `sudo dd` | sudo 磁盘操作 |
| `sudo-fdisk` | `sudo fdisk` | sudo 分区操作 |

### 6. sensitive - 敏感文件

| ID | 模式 | 说明 |
|----|------|------|
| `read-ssh-key` | `cat ~/.ssh/id_rsa` | 读取 SSH 私钥（audit）|
| `read-env` | `cat .env` | 读取环境变量文件（audit）|

### 7. process - 进程管理

| ID | 模式 | 说明 |
|----|------|------|
| `kill-all` | `kill -1` | 杀死所有进程 |
| `killall` | `killall` | 批量杀死进程（warn）|

### 8. package - 包管理

| ID | 模式 | 说明 |
|----|------|------|
| `npm-uninstall-global` | `npm uninstall -g` | 卸载全局包（warn）|
| `pip-uninstall` | `pip uninstall` | 卸载 Python 包（warn）|

---

## API 参考

### 构造函数

```typescript
const gate = new CommandGate({
  enabled: true,           // 是否启用
  strict: false,           // 严格模式（warn 也阻止）
  customBlacklist: [],     // 自定义规则
  ignoreCategories: [],    // 忽略的类别
});
```

### 方法

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `check(command)` | `Promise<GateResult>` | 完整检查命令 |
| `isAllowed(command)` | `boolean` | 快速检查是否允许 |
| `getRiskLevel(command)` | `'high' \| 'medium' \| 'low'` | 获取风险等级 |
| `addRule(rule)` | `void` | 添加自定义规则 |
| `removeRule(id)` | `boolean` | 移除规则 |
| `getBlacklist()` | `CommandBlacklistRule[]` | 获取所有规则 |

### 便捷函数

```typescript
import { isCommandAllowed, getCommandRiskLevel } from '@dommaker/harness';

// 快速检查
if (!isCommandAllowed('rm -rf /')) {
  throw new Error('危险命令');
}

// 获取风险等级
const level = getCommandRiskLevel('DROP TABLE users'); // 'medium'
```

---

## 自定义规则

```typescript
import { CommandGate } from '@dommaker/harness';

const gate = new CommandGate({
  customBlacklist: [{
    id: 'my-custom-rule',
    pattern: /\bmy-dangerous-command\b/i,
    level: 'block',
    message: '自定义危险命令',
    category: 'custom',
  }],
});
```

---

## 使用示例

### 在 Agent Runtime 中使用

```typescript
import { CommandGate } from '@dommaker/harness';

const commandGate = new CommandGate();

async function executeTool(script: string) {
  const result = await commandGate.check(script);
  
  if (!result.passed) {
    throw new Error(`命令被拦截: ${result.message}`);
  }
  
  // 执行命令
  return exec(script);
}
```

### 忽略特定类别

```typescript
// 数据库管理工具可以忽略 database 类别
const gate = new CommandGate({
  ignoreCategories: ['database'],
});
```

### 严格模式

```typescript
// 测试环境可以启用严格模式
const gate = new CommandGate({
  strict: true,  // warn 级别也会阻止
});
```

---

## 测试

```bash
cd /root/projects/harness
npm test -- src/gates/__tests__/command.test.ts
```

测试覆盖：
- ✅ 22 个黑名单规则
- ✅ block/warn/audit 三级
- ✅ 自定义规则
- ✅ 忽略类别
- ✅ 便捷函数
