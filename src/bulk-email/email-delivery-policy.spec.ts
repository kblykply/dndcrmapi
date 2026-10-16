import {
  mailFailure,
  normalizeRecipientEmail,
  queuePolicy,
} from "./email-delivery-policy";
import { perlaLanguage, perlaTemplate } from "./perla-template";

describe("email delivery policy", () => {
  it("rejects multiple recipients and malformed mailboxes", () => {
    for (const address of [
      "a@b",
      "a@b.com,c@d.com",
      "Name <a@b.com>",
      "a@b.com\r\nBcc:other@b.com",
      "a@b.com;other@c.com",
    ])
      expect(normalizeRecipientEmail(address)).toBeNull();
    expect(normalizeRecipientEmail(" Ava@Example.com ")).toBe(
      "ava@example.com",
    );
  });
  it("requires explicit enablement and both provider quotas", () => {
    expect(queuePolicy({}).enabled).toBe(false);
    expect(queuePolicy({ BULK_EMAIL_QUEUE_ENABLED: "true" }).enabled).toBe(
      false,
    );
    expect(
      queuePolicy({
        BULK_EMAIL_QUEUE_ENABLED: "true",
        BULK_EMAIL_HOURLY_LIMIT: "30",
        BULK_EMAIL_DAILY_LIMIT: "150",
      }).enabled,
    ).toBe(true);
  });
  it("retries explicit temporary rejections but not ambiguous DATA timeouts", () => {
    expect(mailFailure({ responseCode: 451, command: "DATA" })).toEqual({
      retry: true,
      suppress: false,
      uncertain: false,
    });
    expect(mailFailure({ code: "ETIMEDOUT", command: "DATA" })).toEqual({
      retry: false,
      suppress: false,
      uncertain: true,
    });
  });
  it("suppresses unknown mailbox replies, never policy rejections", () => {
    expect(
      mailFailure({
        responseCode: 550,
        command: "RCPT TO",
        response: "550 5.1.1 Unknown mailbox",
      }).suppress,
    ).toBe(true);
    expect(
      mailFailure({
        responseCode: 550,
        command: "DATA",
        response: "550 5.7.1 Policy rejected",
      }).suppress,
    ).toBe(false);
  });
  it("uses preferred language before nationality", () => {
    expect(perlaLanguage("English", "Iran")).toEqual({
      language: "en",
      fallback: false,
    });
    expect(perlaLanguage(null, "Turkish Cypriot")).toEqual({ language: "tr", fallback: true });
    expect(perlaLanguage(null, "Iran")).toEqual({
      language: "fa",
      fallback: true,
    });
    expect(perlaLanguage("German", "Russia")).toEqual({
      language: "en",
      fallback: true,
    });
  });
  it.each(["tr", "en", "ru", "fa"] as const)(
    "packages approved %s copy with real inline assets and text fallback",
    async (language) => {
      const mail = await perlaTemplate(language);
      expect(mail.html).not.toContain("localhost");
      expect(mail.html).toContain("cid:dnd-logo");
      expect(mail.html).toContain("cid:perla-hero");
      expect(mail.text.length).toBeGreaterThan(1500);
      expect(
        mail.attachments.reduce((n, a) => n + a.content.length, 0),
      ).toBeLessThan(100000);
      if (language === "fa") expect(mail.html).toContain('dir="rtl"');
    },
  );
});
