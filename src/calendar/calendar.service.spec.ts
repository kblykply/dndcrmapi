import { CalendarService } from './calendar.service';

describe('Callcenter calendar scope', () => {
  it('includes own calls, followups and standalone meetings with accessible detail links', async () => {
    const at = new Date('2026-10-09T12:00:00Z');
    const find = (rows: unknown[] = []) => ({
      findMany: jest.fn().mockResolvedValue(rows),
    });
    const db = {
      lead: find(),
      leadActivity: find(),
      agencyTask: find(),
      agencyMeeting: find([
        {
          id: 'agency-meet',
          createdById: 'cc',
          assignedSalesId: null,
          title: 'Own meeting',
          meetingAt: at,
          agencyId: 'agency',
          agency: { id: 'agency', name: 'Agency' },
          createdBy: { id: 'cc', role: 'CALLCENTER' },
        },
      ]),
      presentation: find(),
      otherMeeting: find([
        {
          id: 'other',
          createdById: 'cc',
          title: 'Own standalone meeting',
          meetingAt: at,
          createdBy: { id: 'cc', role: 'CALLCENTER' },
        },
      ]),
    };
    const service = new CalendarService(db as any);
    const result = await service.getFeed(
      { id: 'cc', role: 'CALLCENTER', email: 'cc@example.test' },
      { from: '2026-10-09T00:00:00Z', to: '2026-10-10T00:00:00Z' },
    );
    expect(result.items.map((row) => row.href)).toEqual([
      '/meetings/agency-meet?kind=AGENCY',
      '/meetings/other?kind=OTHER',
    ]);
    expect(db.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerCallCenterId: 'cc' }),
      }),
    );
    expect(db.leadActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdById: 'cc' }),
      }),
    );
    for (const table of [db.agencyMeeting, db.presentation, db.otherMeeting]) {
      expect(table.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ createdById: 'cc' }, { assignedSalesId: 'cc' }],
          }),
        }),
      );
    }
    expect(db.agencyTask.findMany).not.toHaveBeenCalled();
  });
});
