/**
 * 失败处理类型定义（兼容再导出）
 *
 * 工单 14：类型定义本体已归位 types 层（src/types/failure.ts），
 * 以消除 types/index.ts 对 ../failure 的反向 import。
 * 此文件保留原模块路径，供既有引用方（classifier/recorder/index 与外部消费者）继续工作。
 */

export * from '../types/failure';
