import { BadRequestException, ConflictException } from '@nestjs/common';

export const closedStatuses = ['DONE', 'CANCELLED'];
export function checkVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new ConflictException({
      code: 'WORK_VERSION_CONFLICT',
      message: 'This item was changed by someone else. Refresh before saving.',
    });
}
export function validDates(start: Date | null, due: Date | null) {
  if (start && due && start > due)
    throw new BadRequestException({
      code: 'WORK_DATE_ORDER',
      message: 'The due date cannot be before the start date.',
    });
}
export function wouldCycle(
  edges: { taskId: string; blockerId: string }[],
  taskId: string,
  blockerId: string,
) {
  const next = [blockerId];
  const visited = new Set<string>();
  while (next.length) {
    const id = next.pop()!;
    if (id === taskId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    next.push(
      ...edges
        .filter((edge) => edge.taskId === id)
        .map((edge) => edge.blockerId),
    );
  }
  return false;
}
export function safeFile(file?: Express.Multer.File) {
  if (!file?.buffer?.length || file.size > 5 * 1024 * 1024)
    throw new BadRequestException({
      code: 'WORK_FILE_SIZE',
      message: 'Choose a nonempty file up to 5 MB.',
    });
  const name = file.originalname
    .replace(/[\x00-\x1f\x7f/\\]/g, '_')
    .slice(0, 180);
  const ext = name.split('.').pop()?.toLowerCase();
  const signatures: Record<string, (b: Buffer) => boolean> = {
    pdf: (b) => b.subarray(0, 5).toString() === '%PDF-',
    png: (b) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpg: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
    jpeg: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
    docx: (b) => b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    xlsx: (b) => b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    txt: (b) => !b.includes(0),
    csv: (b) => !b.includes(0),
  };
  if (!ext || !signatures[ext]?.(file.buffer))
    throw new BadRequestException({
      code: 'WORK_FILE_TYPE',
      message: 'Supported files: PDF, PNG, JPG, DOCX, XLSX, TXT, CSV.',
    });
  // All downloads are attachments, never executable inline content, including text and Office ZIP containers.
  return {
    name,
    mimeType: 'application/octet-stream',
    size: file.size,
    content: new Uint8Array(file.buffer),
  };
}
