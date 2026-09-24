import type { AttachmentMeta } from '@shipmate/core';

/** 素材附件上传(multipart → /api/uploads 落盘,返回元数据);素材多附件共用 */
export async function uploadAttachmentFiles(files: File[]): Promise<AttachmentMeta[]> {
  if (!files.length) return [];
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch('/api/uploads', { method: 'POST', body: form });
  if (!res.ok) throw new Error('upload failed');
  const data = (await res.json()) as { files: AttachmentMeta[] };
  return data.files;
}

/** 附件访问 URL(inline 预览;disposition=attachment 下载) */
export function attachmentUrl(a: AttachmentMeta, disposition?: 'attachment'): string {
  const params = new URLSearchParams({ path: a.path, mime: a.mime });
  if (disposition === 'attachment') params.set('disposition', 'attachment');
  return `/api/uploads?${params.toString()}`;
}

/** 字节数 → 展示大小(KB/MB) */
export function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
