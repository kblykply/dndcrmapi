#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");

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

function clean(value) {
  const next = String(value || "").trim();
  return next || null;
}

async function main() {
  loadEnv();

  const host = clean(process.env.IMAP_HOST) || clean(process.env.SMTP_HOST);
  const port = Number(clean(process.env.IMAP_PORT) || "993");
  const secure =
    clean(process.env.IMAP_SECURE)?.toLowerCase() === "true" || port === 993;
  const user = clean(process.env.IMAP_USER) || clean(process.env.SMTP_USER);
  const pass = clean(process.env.IMAP_PASS) || clean(process.env.SMTP_PASS);

  if (!host || !user || !pass || !Number.isFinite(port)) {
    throw new Error("Missing IMAP/SMTP host, user, password, or port");
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  const mailboxes = await client.list();
  await client.logout();

  console.log("IMAP folders:");
  for (const mailbox of mailboxes) {
    const flags = mailbox.specialUse ? ` (${mailbox.specialUse})` : "";
    console.log(`- ${mailbox.path}${flags}`);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
