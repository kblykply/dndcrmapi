import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ProjectDto,
  TaskQueryDto,
  TimeEntryDto,
} from './tasks.dto';
import { checkVersion, validDates, wouldCycle, safeFile } from './work-rules';

describe('Work tracking rules', () => {
  it('rejects stale edits', () => {
    expect(() => checkVersion(2, 1)).toThrow(ConflictException);
    expect(() => checkVersion(2, 2)).not.toThrow();
  });
  it('rejects inverted dates', () => {
    expect(() =>
      validDates(new Date('2026-09-20'), new Date('2026-09-10')),
    ).toThrow(BadRequestException);
    expect(() => validDates(null, new Date())).not.toThrow();
  });
  it('detects direct, transitive and parent/subtask dependency cycles', () => {
    expect(wouldCycle([], 'a', 'a')).toBe(true);
    expect(
      wouldCycle(
        [
          { taskId: 'b', blockerId: 'c' },
          { taskId: 'c', blockerId: 'a' },
        ],
        'a',
        'b',
      ),
    ).toBe(true);
    expect(wouldCycle([{ taskId: 'a', blockerId: 'b' }], 'b', 'a')).toBe(true);
    expect(wouldCycle([{ taskId: 'a', blockerId: 'b' }], 'c', 'a')).toBe(false);
  });
  it('terminates on an existing malformed cycle', () =>
    expect(
      wouldCycle(
        [
          { taskId: 'b', blockerId: 'c' },
          { taskId: 'c', blockerId: 'b' },
        ],
        'a',
        'b',
      ),
    ).toBe(false));
  it('checks file signatures and file size; never serves files inline', () => {
    const file = {
      originalname: '../report.pdf',
      buffer: Buffer.from('%PDF-test'),
      size: 9,
    } as Express.Multer.File;
    expect(safeFile(file)).toMatchObject({
      name: '.._report.pdf',
      mimeType: 'application/octet-stream',
    });
    expect(() =>
      safeFile({ ...file, buffer: Buffer.from('<script>bad</script>') }),
    ).toThrow();
    expect(() => safeFile({ ...file, size: 6000000 })).toThrow();
    expect(() => safeFile({ ...file, originalname: 'test.exe' })).toThrow();
  });
  it('accepts URGENT and the new workflow states', async () => {
    expect(
      await validate(
        plainToInstance(UpdateTaskDto, {
          version: 1,
          priority: 'URGENT',
          status: 'BLOCKED',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreateTaskDto, { title: 'Procurement review' }),
      ),
    ).toHaveLength(0);
  });
  it.each(['status', 'priority', 'kind', 'estimateMinutes', 'labels', 'title'])(
    'rejects null for %s instead of reaching Prisma',
    async (field) => {
      expect(
        (
          await validate(
            plainToInstance(UpdateTaskDto, { version: 1, [field]: null }),
          )
        ).length,
      ).toBeGreaterThan(0);
    },
  );
  it('allows nullable assignees and CRM references', async () => {
    expect(
      await validate(
        plainToInstance(UpdateTaskDto, {
          version: 1,
          assignedToId: null,
          customerId: null,
          startAt: null,
        }),
      ),
    ).toHaveLength(0);
  });
  it('validates pagination, statuses, project keys and logged time', async () => {
    expect(
      (
        await validate(
          plainToInstance(TaskQueryDto, { status: 'NOT_A_STATUS', take: 2000 }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(UpdateTaskDto, { title: 'Changed' })))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(plainToInstance(ProjectDto, { key: 'bad key' }))).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(TimeEntryDto, {
            version: 1,
            minutes: -5,
            workedOn: '2026-09-10',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
