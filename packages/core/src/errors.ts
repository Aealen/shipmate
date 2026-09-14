/** spec §7 错误模型:core 层唯一错误通道,web/mcp 门面按 code 各自映射 */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_STATUS_TRANSITION'
  | 'GROUP_NOT_EMPTY'
  | 'MODULE_NAME_TAKEN'
  | 'PROJECT_HAS_NO_REQUIREMENTS'
  | 'LLM_ERROR'
  | 'LLM_SCHEMA_MISMATCH'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
