import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { OrgChartService, type OrganizationNode } from "./org-chart.service";
import { PrismaService } from "../prisma/prisma.service";
import { OrgDefinitionDto } from "./org-chart.dto";

const admin = { id: "admin", role: "ADMIN" as const };
const sales = { id: "sales", role: "SALES" as const };
const dto: OrgDefinitionDto = {
  name: "Operations director", kind: "POSITION", code: "JOB-01", purpose: "Manage operations",
  responsibilities: "Manage quality processes", authority: "Approve operational plans",
  competencies: "Project management experience", reviewDueAt: "2099-01-01", processes: [],
};
const makeNode = (overrides: Partial<OrganizationNode> = {}): OrganizationNode => ({
  id: "position", name: dto.name, kind: "POSITION", code: "JOB-01", parentId: null, order: 0,
  type: null, color: null, purpose: dto.purpose!, responsibilities: dto.responsibilities!,
  authority: dto.authority!, competencies: dto.competencies!, performanceIndicators: null,
  reviewDueAt: new Date("2099-01-01"), status: "DRAFT", revision: 1, version: 1,
  assigneeId: null, assignee: null, approvedById: null, approvedBy: null, approvedAt: null,
  acknowledgedAt: null, acknowledgedRevision: null, processes: [], createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

describe("Organization management", () => {
  let node: OrganizationNode;
  let db: {
    $transaction: jest.Mock; $executeRaw: jest.Mock;
    user: { findUnique: jest.Mock; findMany: jest.Mock };
    orgChartNode: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; count: jest.Mock };
    orgChartLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    qualityProcessCard: { count: jest.Mock; findMany: jest.Mock };
  };
  let service: OrgChartService;
  beforeEach(() => {
    node = makeNode();
    db = {
      $transaction: jest.fn(), $executeRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ id: admin.id, name: "Admin", isActive: true, role: "ADMIN" }), findMany: jest.fn() },
      orgChartNode: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string; code?: string } }) => where.code ? null : node),
        findMany: jest.fn().mockResolvedValue([node]), create: jest.fn().mockResolvedValue(node),
        update: jest.fn().mockResolvedValue(node), count: jest.fn().mockResolvedValue(0),
      },
      orgChartLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      qualityProcessCard: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
    };
    db.$transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => fn(db));
    service = new OrgChartService(db as unknown as PrismaService);
  });

  it.each(["SALES", "CALLCENTER", "AFTERSALES", "ACCOUNTING", "PREVIEW"] as const)("rejects writes for %s", async (role) => {
    await expect(service.create({ id: "viewer", role }, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("does not read any business data for preview, including interceptor-transformed users", async () => {
    const preview = { ...admin, originalRole: "PREVIEW" as const, isPreview: true };
    await expect(service.workspace(preview)).resolves.toEqual({ nodes: [], users: [], qualityCards: [] });
    await expect(service.getOne(preview, "anything")).resolves.toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.orgChartNode.findUnique).not.toHaveBeenCalled();
  });
  it("checks the current database role even when an old token still says ADMIN", async () => {
    db.user.findUnique.mockResolvedValue({ id: admin.id, name: "Former admin", isActive: true, role: "SALES" });
    await expect(service.create(admin, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.orgChartNode.create).not.toHaveBeenCalled();
  });
  it("preserves old definition and actor in the audit log", async () => {
    await service.update(admin, node.id, { ...dto, name: "Updated title", version: 1 });
    expect(db.orgChartLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorId: "admin", actorName: "Admin", action: "DEFINITION_UPDATED", beforeJson: expect.objectContaining({ name: dto.name }),
    }) }));
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "DRAFT", revision: { increment: 1 }, approvedAt: null, acknowledgedAt: null,
    }) }));
  });
  it("rejects stale revisions without writing", async () => {
    await expect(service.update(admin, node.id, { ...dto, version: 2 })).rejects.toBeInstanceOf(ConflictException);
    expect(db.orgChartNode.update).not.toHaveBeenCalled();
  });
  it("prevents a reporting cycle", async () => {
    await expect(service.update(admin, node.id, { ...dto, parentId: node.id, version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("rejects a pre-existing cycle in ancestors without looping", async () => {
    db.orgChartNode.findUnique.mockImplementation(({ where }: { where: { id?: string } }) =>
      where.id === node.id ? node : { ...node, id: "ancestor", parentId: "ancestor" });
    await expect(service.update(admin, node.id, { ...dto, parentId: "ancestor", version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("requires complete definitions before approval", async () => {
    node.purpose = null;
    await expect(service.action(admin, node.id, "APPROVED", { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("approves complete definitions with an approver and timestamp", async () => {
    await service.action(admin, node.id, "APPROVED", { version: 1 });
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "APPROVED", approvedById: admin.id, approvedAt: expect.any(Date),
    }) }));
  });
  it("rejects past review dates on approval", async () => {
    node.reviewDueAt = new Date("2000-01-01");
    await expect(service.action(admin, node.id, "APPROVED", { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("retains assignment history and invalidates only the acknowledgment on reassignment", async () => {
    node.assigneeId = "previous"; node.assignee = { id: "previous", name: "Previous occupant", isActive: true };
    await service.assign(admin, node.id, { version: 1, userId: "next" });
    expect(db.orgChartLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "ASSIGNMENT_CHANGED", beforeJson: expect.objectContaining({ assignee: expect.objectContaining({ name: "Previous occupant" }) }),
    }) }));
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      assigneeId: "next", version: { increment: 1 }, acknowledgedAt: null, acknowledgedRevision: null,
    } }));
  });
  it("cannot assign a department", async () => {
    node.kind = "DEPARTMENT";
    await expect(service.assign(admin, node.id, { version: 1, userId: "next" })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("cannot assign inactive accounts", async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: admin.id, name: "Admin", isActive: true, role: "ADMIN" }).mockResolvedValueOnce({ isActive: false });
    await expect(service.assign(admin, node.id, { version: 1, userId: "inactive" })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("prevents assigned positions from changing to departments", async () => {
    node.assigneeId = "person";
    await expect(service.update(admin, node.id, { ...dto, kind: "DEPARTMENT", version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("only lets the current occupant acknowledge an approved revision", async () => {
    node.assigneeId = sales.id; node.status = "APPROVED";
    db.user.findUnique.mockResolvedValue({ id: sales.id, name: "Sales", isActive: true });
    await service.action(sales, node.id, "ACKNOWLEDGED", { version: 1 });
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ acknowledgedRevision: 1, acknowledgedAt: expect.any(Date) }) }));
  });
  it("rejects another person's acknowledgment", async () => {
    node.assigneeId = "other"; node.status = "APPROVED";
    await expect(service.action(admin, node.id, "ACKNOWLEDGED", { version: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("does not archive occupied positions", async () => {
    node.assigneeId = "person";
    await expect(service.action(admin, node.id, "ARCHIVED", { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("does not archive a parent with active children", async () => {
    db.orgChartNode.count.mockResolvedValue(1);
    await expect(service.action(admin, node.id, "ARCHIVED", { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("archives without hard-deleting history", async () => {
    await service.action(admin, node.id, "ARCHIVED", { version: 1 });
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED" }) }));
    expect(db.orgChartLog.create).toHaveBeenCalled();
  });
  it("restores as draft with approval cleared", async () => {
    node.status = "ARCHIVED";
    await service.action(admin, node.id, "RESTORED", { version: 1 });
    expect(db.orgChartNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", approvedAt: null }) }));
  });
  it("rejects duplicate process links", async () => {
    const link = { cardId: "card", responsibility: "RESPONSIBLE" as const };
    await expect(service.update(admin, node.id, { ...dto, processes: [link, link], version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it("rejects missing or archived quality processes", async () => {
    await expect(service.update(admin, node.id, { ...dto, processes: [{ cardId: "missing", responsibility: "ACCOUNTABLE" }], version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
