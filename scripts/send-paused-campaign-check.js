/* Send exactly one existing campaign job while every automatic worker remains paused.
 * Default: validation only. Usage: node scripts/send-paused-campaign-check.js
 *   --campaign ID --email EMAIL --expected-sender EMAIL [--send-one]
 */
require('dotenv/config');
const assert = require('node:assert/strict');
const { PrismaService } = require('../dist/src/prisma/prisma.service');
const { EmailService } = require('../dist/src/email/email.service');
const { BulkEmailQueueService } = require('../dist/src/bulk-email/bulk-email-queue.service');
const { ImapFlow } = require('imapflow');
const { perlaTemplate } = require('../dist/src/bulk-email/perla-template');
const { unitEmailSubject } = require('../dist/src/bulk-email/unit-email-subject');
const args = process.argv.slice(2);
const argument = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const campaignId = argument('--campaign');
const targetEmail = argument('--email');
const expectedSender = argument('--expected-sender');
const commit = args.includes('--send-one');
const database = new PrismaService();
const snapshot = rows => JSON.stringify(rows.map(r => ({ id: r.id, status: r.status, sentAt: r.sentAt, error: r.error })).sort((a,b) => a.id.localeCompare(b.id)));

async function run() {
  assert(campaignId && targetEmail && expectedSender, 'Campaign, recipient and expected sender are required');
  assert.equal(process.env.SMTP_USER, expectedSender, 'Unexpected SMTP account');
  assert((process.env.SMTP_FROM || '').includes(`<${expectedSender}>`), 'Unexpected From address');
  const campaign = await database.bulkEmailCampaign.findUnique({ where: { id: campaignId }, include: { recipients: true } });
  assert(campaign?.pausedAt && campaign.status === 'SENDING', 'Campaign must remain paused');
  const matches = campaign.recipients.filter(r => r.email === targetEmail);
  assert.equal(matches.length, 1, 'Expected exactly one recipient');
  const recipient = matches[0];
  assert.equal(recipient.status, 'QUEUED', 'Recipient is not queued; never resend a sent or uncertain email');
  assert.equal(await database.bulkEmailJob.count({ where: { status: 'SENDING' } }), 0, 'Another delivery is in flight');
  assert.equal(await database.bulkEmailSuppression.findUnique({ where: { email: targetEmail } }), null, 'Recipient is suppressed');
  const job = await database.bulkEmailJob.findUnique({ where: { recipientId: recipient.id } });
  assert(job && job.campaignId === campaignId && job.status === 'QUEUED' && job.attempts === 0, 'Expected an unattempted queued job');
  const payload = job.payload;
  assert.equal(payload.to, targetEmail);
  assert.equal(payload.replyTo, expectedSender);
  assert.equal(payload.subject, recipient.subject);
  assert.equal(payload.subject, unitEmailSubject(campaign.project, recipient.unitSnapshot.map(unit => unit.unitNumber)));
  const template = await perlaTemplate(recipient.deliveryLanguage);
  assert.equal(payload.html, template.html);
  assert.equal(payload.text, template.text);
  assert.equal(payload.attachments.length, template.attachments.length);
  for (let i = 0; i < template.attachments.length; i++) {
    assert.equal(payload.attachments[i].content, template.attachments[i].content.toString('base64'));
  }
  const beforeOthers = snapshot(campaign.recipients.filter(r => r.id !== recipient.id));
  const email = new EmailService();
  // Connection/authentication checks; neither sends a message.
  const transport = email.transporter();
  try { await transport.verify(); } finally { transport.close(); }
  const config = email.imapConfig();
  assert(config && config.user === expectedSender, 'Sent-folder account must match sender');
  const imap = new ImapFlow({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.pass }, logger: false, connectionTimeout: 10000, socketTimeout: 15000 });
  try { await imap.connect(); await imap.mailboxOpen(config.sentFolder, { readOnly: true }); } finally { await imap.logout().catch(() => {}); }
  console.log(JSON.stringify({ mode: commit ? 'send-one' : 'validation-only', campaignId, recipient: targetEmail, subject: payload.subject, language: recipient.deliveryLanguage, smtpVerified: true, sentFolderVerified: true, campaignPaused: true }));
  if (!commit) return;

  await database.$transaction(async tx => {
    const current = await tx.bulkEmailCampaign.findUnique({ where: { id: campaignId } });
    assert(current?.pausedAt, 'Campaign was resumed by another operator');
    const first = await tx.bulkEmailJob.findFirst({ where: { campaignId, status: 'QUEUED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const moved = await tx.bulkEmailJob.updateMany({ where: { id: job.id, status: 'QUEUED', attempts: 0 }, data: { createdAt: new Date(first.createdAt.getTime() - 1) } });
    assert.equal(moved.count, 1, 'Job changed before prioritization');
  });
  process.env.BULK_EMAIL_QUEUE_ENABLED = 'true';
  process.env.BULK_EMAIL_HOURLY_LIMIT = '100';
  process.env.BULK_EMAIL_DAILY_LIMIT = '300';
  process.env.BULK_EMAIL_INTERVAL_SECONDS = '36';
  let calls = 0;
  const guardedEmail = { sendMail: async input => {
    assert.equal(++calls, 1, 'Only one SMTP submission is authorized');
    assert.equal(input.to, targetEmail, 'Unexpected recipient; refusing SMTP');
    assert.equal(input.subject, payload.subject);
    return email.sendMail(input);
  } };
  const worker = new BulkEmailQueueService(database, guardedEmail);
  // Do not call onModuleInit: no background timer and no campaign resume.
  await worker.sendOnePausedJob(campaignId, job.id);
  const after = await database.bulkEmailCampaign.findUnique({ where: { id: campaignId }, include: { recipients: true } });
  assert(after.pausedAt, 'Campaign pause must be preserved');
  assert.equal(snapshot(after.recipients.filter(r => r.id !== recipient.id)), beforeOthers, 'Another recipient record changed');
  const sent = after.recipients.find(r => r.id === recipient.id);
  const savedJob = await database.bulkEmailJob.findUnique({ where: { id: job.id }, select: { status: true, messageId: true } });
  console.log(JSON.stringify({ smtpCalls: calls, recipientStatus: sent.status, jobStatus: savedJob.status, campaignPaused: true, otherRecipientsUnchanged: true, counts: after.recipients.reduce((counts,r) => (counts[r.status]=(counts[r.status]||0)+1,counts), {}) }));
  assert.equal(sent.status, 'SENT', 'Mail was not confirmed sent; inspect status before any further attempt');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => database.onModuleDestroy());
