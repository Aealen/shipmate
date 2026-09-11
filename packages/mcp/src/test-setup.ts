import { loadDotEnv } from '@shipmate/core';

// 在任何测试文件求值前加载仓库根 .env,
// 使 SHIPMATE_TEST_DATABASE_URL 可被测试文件模块顶层读取(先于 vitest 收集阶段)。
loadDotEnv();
