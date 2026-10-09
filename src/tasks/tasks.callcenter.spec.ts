import { TasksService } from './tasks.service';

describe('Callcenter assigned work only', () => {
  const actor = {
    id: 'cc',
    role: 'CALLCENTER',
    name: 'Callcenter',
    isActive: true,
  };
  const service = new TasksService({} as any, {} as any);
  it('restricts every task read to direct assignment, including project tasks', () => {
    expect(service['accessWhere'](actor)).toEqual({ assignedToId: 'cc' });
    expect(service['projectWhere'](actor)).toEqual({
      tasks: { some: { assignedToId: 'cc' } },
    });
  });
  it('permits editing an assigned project task without granting other member tasks', () => {
    const task = {
      assignedToId: 'cc',
      project: { ownerId: 'other', members: [] },
    } as any;
    expect(service['canEdit'](actor, task)).toBe(true);
    expect(
      service['canEdit'](actor, {
        ...task,
        assignedToId: 'other',
        createdById: 'cc',
        project: { ownerId: 'cc', members: [{ userId: 'cc', role: 'LEAD' }] },
      }),
    ).toBe(false);
    expect(service['canArchive'](actor, task)).toBe(false);
    expect(service['canManageProject'](actor, task.project)).toBe(false);
  });
  it('redacts unassigned parent and blocker summaries from assigned task results', () => {
    const task = {
      assignedToId: 'cc',
      timeEntries: [],
      parent: { assignedToId: 'other', title: 'Private' },
      blockers: [
        { blocker: { assignedToId: 'other', title: 'Private' } },
        { blocker: { assignedToId: 'cc', title: 'Own' } },
      ],
    } as any;
    const result = service['present'](task, actor);
    expect(result.parent).toBeNull();
    expect(result.blockers).toHaveLength(1);
  });
});
