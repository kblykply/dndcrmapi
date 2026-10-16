import { BulkEmailQueueService } from "./bulk-email-queue.service";

describe("durable bulk email queue", () => {
  const original = { ...process.env };
  let db: any, email: any, queue: BulkEmailQueueService;
  const job = {
    id: "job",
    recipientId: "recipient",
    campaignId: "campaign",
    attempts: 0,
    payload: {
      to: "test@example.com",
      subject: "Test",
      text: "Body",
      unitIds: [],
      attachments: [],
    },
  };
  beforeEach(() => {
    process.env.BULK_EMAIL_QUEUE_ENABLED = "true";
    process.env.BULK_EMAIL_HOURLY_LIMIT = "10";
    process.env.BULK_EMAIL_DAILY_LIMIT = "50";
    db = {
      bulkEmailJob: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bulkEmailRecipient: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ status: "SENT" }]),
      },
      bulkEmailSuppression: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      bulkEmailCampaign: { update: jest.fn() },
      bulkEmailDispatchState: { update: jest.fn() },
      customerUnitSelectionLog: { createMany: jest.fn() },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            nextSendAt: new Date(0),
            windowStartedAt: new Date(),
            count: 0,
            dayStartedAt: new Date(),
            dayCount: 0,
          },
        ])
        .mockResolvedValueOnce([job]),
    };
    db.$transaction = jest.fn(async (input: any) =>
      typeof input === "function" ? input(db) : Promise.all(input),
    );
    email = {
      sendMail: jest.fn().mockImplementation(async () => {
        expect(db.bulkEmailJob.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: "SENDING" }),
          }),
        );
        return { messageId: "message", accepted: ["test@example.com"] };
      }),
    };
    queue = new BulkEmailQueueService(db, email);
  });
  afterEach(() => {
    process.env = { ...original };
    queue.onModuleDestroy();
  });
  it("does not claim or send until explicitly enabled with quotas", async () => {
    delete process.env.BULK_EMAIL_DAILY_LIMIT;
    await queue.tick();
    expect(email.sendMail).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("claims before SMTP and persists acceptance even if unit audit logging fails", async () => {
    db.customerUnitSelectionLog.createMany.mockRejectedValue(
      new Error("audit unavailable"),
    );
    await queue.tick();
    expect(email.sendMail).toHaveBeenCalledTimes(1);
    expect(db.bulkEmailJob.update).toHaveBeenCalledWith({
      where: { id: "job" },
      data: { status: "SENT", messageId: "message", payload: {} },
    });
    expect(db.bulkEmailRecipient.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
  it("does not automatically resend a DATA timeout with ambiguous acceptance", async () => {
    email.sendMail.mockRejectedValue({ code: "ETIMEDOUT", command: "DATA" });
    await queue.tick();
    expect(db.bulkEmailJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNCERTAIN" }),
      }),
    );
  });
  it("reschedules explicit temporary rejection with backoff", async () => {
    email.sendMail.mockRejectedValue({ responseCode: 451, command: "DATA" });
    await queue.tick();
    expect(db.bulkEmailJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          availableAt: expect.any(Date),
        }),
      }),
    );
  });
  it("respects the persisted hourly rate limit across workers", async () => {
    db.$queryRaw.mockReset().mockResolvedValueOnce([
      {
        nextSendAt: new Date(0),
        windowStartedAt: new Date(),
        count: 10,
        dayStartedAt: new Date(),
        dayCount: 10,
      },
    ]);
    await queue.tick();
    expect(email.sendMail).not.toHaveBeenCalled();
    expect(db.bulkEmailDispatchState.update).not.toHaveBeenCalled();
  });
});
