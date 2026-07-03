#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnv();

  const { EmailService } = require("../dist/src/email/email.service");
  const service = new EmailService();
  const to = process.env.EMAIL_TEST_TO || process.env.SMTP_USER;
  const now = new Date().toISOString();

  const result = await service.sendMail({
    to,
    subject: `CRM sent-folder test ${now}`,
    text: `This is a CRM email smoke test.\n\nTime: ${now}`,
  });

  console.log(`Sent test email to ${to}`);
  console.log(`Message id: ${result.messageId || "-"}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
