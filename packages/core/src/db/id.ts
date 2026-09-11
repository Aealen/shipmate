import { v7 as uuidv7 } from 'uuid';

/** 所有表主键生成器:UUID v7,时间有序(spec D1) */
export const newId = (): string => uuidv7();
