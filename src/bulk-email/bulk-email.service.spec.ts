import { BulkEmailService } from "./bulk-email.service";

describe("bulk campaign enqueue", () => {
  let db: any, mail: any, service: BulkEmailService;
  const user = { id: "user", email: "me@example.com" };
  const recipient = {
    customerId: "customer",
    fullName: "Owner",
    email: "owner@example.com",
    units: [
      {
        id: "unit",
        project: "LA_JOYA_PERLA",
        unitNumber: "Z2",
        deliveryStatus: "NOT_READY",
      },
    ],
  };
  beforeEach(() => {
    db = {
      bulkEmailCampaign: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "campaign",
          name: "Test",
          project: "LA_JOYA_PERLA",
          createdAt: new Date(),
          attemptedCount: 1,
          status: "SENDING",
        }),
      },
      bulkEmailRecipient: { createMany: jest.fn() },
      bulkEmailJob: { createMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    db.$transaction = jest.fn((f: any) => f(db));
    mail = { sendMail: jest.fn() };
    service = new BulkEmailService(db, mail);
    jest.spyOn(service as any, "buildRecipientPreview").mockResolvedValue({
      recipients: [recipient],
      missingEmail: [],
      totalUnits: 1,
      uniqueCustomers: 1,
    });
    jest.spyOn(service as any, "buildAttachmentBundle").mockResolvedValue({
      shared: [],
      byCustomerId: new Map(),
      selectedNames: [],
    });
  });
  it("atomically persists pending jobs without sending SMTP inside HTTP request", async () => {
    const result = await service.sendBulkEmail(user, {
      project: "LA_JOYA_PERLA",
      subject: "Update",
      message: "Body",
    });
    expect(result.queued).toBe(true);
    expect(result.campaignStatus).toBe("SENDING");
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(db.bulkEmailRecipient.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ status: "QUEUED", customerId: "customer" }),
      ],
    });
    expect(db.bulkEmailJob.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          campaignId: "campaign",
          payload: expect.objectContaining({ to: "owner@example.com" }),
        }),
      ],
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("reuses identical request instead of enqueueing duplicate messages", async () => {
    db.bulkEmailCampaign.findUnique.mockResolvedValue({
      id: "existing",
      name: "Test",
      project: "LA_JOYA_PERLA",
      createdAt: new Date(),
      attemptedCount: 1,
      status: "SENDING",
    });
    const result = await service.sendBulkEmail(user, {
      project: "LA_JOYA_PERLA",
      subject: "Update",
      message: "Body",
    });
    expect(result.campaignId).toBe("existing");
    expect(db.bulkEmailJob.createMany).not.toHaveBeenCalled();
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
  it("orders the approved campaign by language then unit and persists that order", async () => {
    (service as any).buildRecipientPreview.mockResolvedValue({
      recipients: [
        { ...recipient, customerId: "english", email: "english@example.com", language: "en", units: [{ ...recipient.units[0], unitNumber: "A1" }] },
        { ...recipient, customerId: "turkish2", email: "turkish2@example.com", language: "tr", units: [{ ...recipient.units[0], unitNumber: "A10" }] },
        { ...recipient, customerId: "turkish1", email: "turkish1@example.com", language: "tr", units: [{ ...recipient.units[0], unitNumber: "A2" }] },
      ], missingEmail: [], totalUnits: 3, uniqueCustomers: 3,
    });
    await service.sendBulkEmail(user, { project: "LA_JOYA_PERLA", templateId: "perla-update", subject: "Update", message: "Approved copy" });
    const rows = db.bulkEmailJob.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.payload.to)).toEqual(["turkish1@example.com", "turkish2@example.com", "english@example.com"]);
    expect(rows[0].createdAt.getTime()).toBeLessThan(rows[1].createdAt.getTime());
    expect(rows[1].createdAt.getTime()).toBeLessThan(rows[2].createdAt.getTime());
  });

});
