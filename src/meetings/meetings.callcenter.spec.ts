import { MeetingsService } from './meetings.service';

describe('Callcenter meeting detail access', () => {
  const actor = {
    id: 'cc',
    role: 'CALLCENTER' as const,
    email: 'cc@example.test',
  };
  const service = new MeetingsService({} as any, {} as any);
  it.each([
    'canSeeAgencyMeeting',
    'canSeePresentation',
    'canSeeOtherMeeting',
  ] as const)('%s allows only created or assigned meetings', (method) => {
    expect(service[method](actor, { createdById: 'cc' })).toBe(true);
    expect(service[method](actor, { assignedSalesId: 'cc' })).toBe(true);
    expect(
      service[method](actor, {
        createdById: 'other',
        assignedSalesId: 'other',
        agency: { assignedSalesId: 'cc' },
      }),
    ).toBe(false);
  });
});
