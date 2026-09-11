/**
 * 测试工厂统一出口:事务回滚隔离(withDb)与 .env 加载(loadDotEnv)。
 * 实现位于 database.ts(与连接工厂同文件,避免循环依赖),此处仅重导出,
 * 供后续任务/测试统一从 test-utils.js 导入。
 */
export { loadDotEnv, withDb } from './database.js';
