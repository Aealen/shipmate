import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './index.js';

describe('core 包骨架', () => {
  it('导出版本号', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
