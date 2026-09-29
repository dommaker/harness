# harness SDD 约定

SDD（Spec-Driven Development 文档）的目录布局与 frontmatter 字段是 harness 的正式约定，
由 `src/sdd/`（SDD Index Generator）机器消费：扫描布局生成 `docs/sdd/_index.md`，
供 grep 定位后按目录读全文（`harness sdd index` 重建）。

## 目录布局

```
docs/sdd/<slug>/requirement.md
```

- 每个 SDD 一个目录，目录名即 slug；
- 每目录一份 `requirement.md`，无此文件的目录不进索引。

## frontmatter 字段

| 字段 | 语义 |
|------|------|
| `slug` | SDD 标识；缺省取目录名 |
| `pmoNumber` | **可选的外部工单号**——对接外部工单系统时填，纯标识字段，harness 不解析不校验 |
| `status` | 状态；`stale` 的 SDD 不进索引 |
| `title` | 标题；缺省取目录名（索引前做换行/竖线清洗） |
| `tags` | 标签数组，索引中以逗号连接 |

frontmatter 损坏（malformed）必须显式上报（stderr）后跳过该条目，不静默丢失（harness#89）。

## 索引格式

`_index.md` 每行一条：`slug|pmoNumber|status|title|tags`，按 slug 字典序排列。
用法：`grep "<pmoNumber>" docs/sdd/_index.md`，再读对应目录全文。
