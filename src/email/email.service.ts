import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

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

  async sendMail(input: SendMailInput) {
    const to = this.cleanStr(input.to);
    const subject = this.cleanStr(input.subject);
    const text = this.cleanStr(input.text);

    if (!to) throw new BadRequestException("Recipient email is required");
    if (!subject) throw new BadRequestException("Subject is required");
    if (!text) throw new BadRequestException("Message is required");

    const from =
      this.cleanStr(process.env.SMTP_FROM) || this.requireConfig("SMTP_USER");

    return this.transporter().sendMail({
      from,
      to,
      subject,
      text,
      html: input.html,
      replyTo: this.cleanStr(input.replyTo) || undefined,
      attachments: input.attachments,
    });
  }
}
