import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private cleanStr(value?: string | null) {
    const next = (value || "").trim();
    return next || null;
  }

  private requireConfig(name: string) {
    const value = this.cleanStr(process.env[name]);
    if (!value) {
      throw new ServiceUnavailableException(`${name} is not configured`);
    }
    return value;
  }

  private transporter() {
    const host = this.requireConfig("SMTP_HOST");
    const port = Number(this.requireConfig("SMTP_PORT"));
    const user = this.requireConfig("SMTP_USER");
    const pass = this.requireConfig("SMTP_PASS");
    const secure =
      String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
      port === 465;

    if (!Number.isFinite(port)) {
      throw new ServiceUnavailableException("SMTP_PORT is invalid");
    }

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  private boolConfig(name: string, fallback: boolean) {
    const value = this.cleanStr(process.env[name]);
    if (!value) return fallback;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  private unique(values: Array<string | null | undefined>) {
    return values.filter((value, index, list): value is string => {
      return Boolean(value) && list.indexOf(value) === index;
    });
  }

  private imapConfig() {
    const enabled = this.boolConfig("IMAP_SAVE_SENT", true);
    if (!enabled) return null;

    const host = this.cleanStr(process.env.IMAP_HOST) || this.requireConfig("SMTP_HOST");
    const port = Number(this.cleanStr(process.env.IMAP_PORT) || "993");
    const user = this.cleanStr(process.env.IMAP_USER) || this.requireConfig("SMTP_USER");
    const pass = this.cleanStr(process.env.IMAP_PASS) || this.requireConfig("SMTP_PASS");
    const secure = this.boolConfig("IMAP_SECURE", port === 993);
    const sentFolder =
      this.cleanStr(process.env.IMAP_SENT_FOLDER) || "Gönderilmiş Öğeler";

    if (!Number.isFinite(port)) {
      this.logger.warn("IMAP_PORT is invalid; sent-folder save is skipped");
      return null;
    }

    return { host, port, user, pass, secure, sentFolder };
  }

  private async appendToSent(raw: Buffer) {
    const config = this.imapConfig();
    if (!config) return;

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      logger: false,
    });

    try {
      await client.connect();
      const mailboxes = await client.list();
      const mailboxPaths = mailboxes.map((mailbox) => mailbox.path);
      const candidates = this.unique([
        config.sentFolder,
        "Gönderilmiş Öğeler",
        "Sent",
        "Sent Items",
        "INBOX.Sent",
      ]);
      const selected =
        candidates.find((folder) => mailboxPaths.includes(folder)) ||
        candidates.find((folder) =>
          mailboxPaths.some(
            (path) => path.toLowerCase() === folder.toLowerCase(),
          ),
        ) ||
        config.sentFolder;

      await client.append(selected, raw, ["\\Seen"], new Date());
    } catch (error: any) {
      this.logger.warn(
        `Email sent, but saving to IMAP sent folder failed: ${
          error?.message || error
        }`,
      );
    } finally {
      try {
        await client.logout();
      } catch {
        // The connection may already be closed after an IMAP error.
      }
    }
  }

  async sendMail(input: SendMailInput) {
    const to = this.cleanStr(input.to);
    const subject = this.cleanStr(input.subject);
    const text = this.cleanStr(input.text);

    if (!to) throw new BadRequestException("Recipient email is required");
    if (!subject) throw new BadRequestException("Subject is required");
    if (!text) throw new BadRequestException("Message is required");

    const from =
      this.cleanStr(process.env.SMTP_FROM) || this.requireConfig("SMTP_USER");
    const smtpUser = this.requireConfig("SMTP_USER");
    const replyTo = this.cleanStr(input.replyTo) || undefined;
    const message: Mail.Options = {
      from,
      to,
      subject,
      text,
      html: input.html,
      replyTo,
      attachments: input.attachments,
    };
    const raw = await new MailComposer(message).compile().build();

    const result = await this.transporter().sendMail({
      envelope: {
        from: smtpUser,
        to,
      },
      raw,
    });

    await this.appendToSent(raw);
    return result;
  }
}
