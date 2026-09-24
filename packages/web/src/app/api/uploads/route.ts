import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 素材附件上传(素材多附件):multipart/form-data 收文件,落盘 data/uploads/,
 * 返回附件元数据数组供 addMaterialAction 随素材提交。单文件上限 20MB。
 */

const UPLOAD_ROOT = path.join(process.cwd(), 'data', 'uploads');
const MAX_SIZE = 20 * 1024 * 1024;

/** 防目录穿越:解析后必须仍在 UPLOAD_ROOT 内(route 文件不允许额外导出,保持模块私有) */
function resolveUploadPath(relPath: string): string {
  const full = path.resolve(UPLOAD_ROOT, relPath);
  if (!full.startsWith(UPLOAD_ROOT + path.sep) && full !== UPLOAD_ROOT) {
    throw new Error('invalid path');
  }
  return full;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: 'no files' }, { status: 400 });
    }
    const saved = [];
    for (const file of files) {
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: `file too large: ${file.name}` }, { status: 413 });
      }
      const dir = randomUUID();
      const safeName = file.name.replace(/[\\/]/g, '_');
      const relPath = path.join(dir, safeName);
      const full = resolveUploadPath(relPath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(await file.arrayBuffer()));
      saved.push({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', path: relPath });
    }
    return NextResponse.json({ files: saved });
  } catch {
    return NextResponse.json({ error: 'upload failed' }, { status: 500 });
  }
}

/** 附件读取:inline 预览(?disposition=attachment 时下载);path 相对 data/uploads/ */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const relPath = searchParams.get('path') ?? '';
  const download = searchParams.get('disposition') === 'attachment';
  try {
    const full = resolveUploadPath(relPath);
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(full);
    const name = path.basename(relPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': searchParams.get('mime') || 'application/octet-stream',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
