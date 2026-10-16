# Perla email delivery

The approved announcement stays in one email, including cafe, handover and furniture sections.

## DNS action required

No DNS management credentials are available in this workspace. At the authoritative DNS provider, add a TXT record (only if no DMARC record already exists):

- Name: `_dmarc` (full hostname `_dmarc.dndcyprus.com`)
- Value: `v=DMARC1; p=none; adkim=r; aspf=r;`
- TTL: 3600

This initial policy monitors authentication without asking receivers to quarantine legitimate mail. It does not guarantee inbox placement. Add `rua` only after setting up a reporting mailbox/service; do not invent an address. After a review of all legitimate sending services, consider a stricter policy. SPF and default DKIM DNS records existed at inspection; actual SPF/DKIM alignment must be verified in received message headers.

## Provider action required

Ask the SMTP provider for account-level hourly and daily recipient limits, any shared-IP restrictions, and confirmation that SMTP messages are DKIM-signed for dndcyprus.com and that the outbound IP has matching PTR/forward DNS. Include other mailbox activity in these quotas; queue limits cover this application only.

The worker is paused by default. Only enable after quota confirmation:

```
BULK_EMAIL_QUEUE_ENABLED=true
BULK_EMAIL_INTERVAL_SECONDS=60
BULK_EMAIL_HOURLY_LIMIT=<application allocation within provider hourly quota>
BULK_EMAIL_DAILY_LIMIT=<application allocation within provider daily quota>
```

Both limits must be positive integers, interval at least 10 seconds. Deploy migration before backend. A single global DB dispatch row enforces queue pacing across API replicas. Existing pending jobs remain paused until the switch is enabled. Do not enable local and production with differing quota settings; all workers must share the same approved policy.

## Behaviour

- Recipient preview excludes invalid addresses, suppressed unknown mailboxes and shared addresses within the selected customer set. Shared addresses are listed for explicit review rather than combining private documents. Selecting one reviewed customer explicitly resolves that selection.
- Only active, non-cancelled units belonging to EXISTING customers are included. No real customers are emailed by tests.
- Perla template is explicit opt-in. Preferred language overrides nationality; missing language uses supported nationality mappings; unsupported/unknown preferences fall back to English and are flagged for review. Preview language controls display only; test and production delivery use the selected recipient's stored preference.
- Templates include plain text, HTML, and optimized inline CID assets (~84KB combined). No localhost links, tracking pixels, or new public uploads. Artwork may be hidden by a mail client; all substantive text stays readable.
- Campaigns and jobs are persisted atomically; deterministic fingerprint prevents identical campaign re-submission. Changing the message/attachments/recipient selection makes a new campaign. Templates are rendered and saved at enqueue time, so restarts don't change pending content.
- A job is committed as SENDING before SMTP. Explicit 4xx rejections use bounded exponential backoff. Ambiguous delivery (e.g. acknowledgement lost after DATA or worker interruption) becomes UNCERTAIN and is not automatically resent. Check provider logs first. No exactly-once SMTP guarantee is possible.
- Confirmed SMTP acceptance is persisted before optional customer unit audit logging. SENT means SMTP accepted, not inbox placement or read receipt. Later delivery bounces/complaints aren't ingested yet; providers' notifications must be reviewed, and permanent invalid addresses manually suppressed if the initial SMTP accepted them.
- Payloads are cleared after success; failed payloads stay in private RLS-protected tables so an explicit retry retains attachments. Retry excludes uncertain deliveries and suppressed addresses. Only confirmed failures are eligible.
- A provider 5.1.x unknown-recipient reply at RCPT TO suppresses that mailbox. Generic policy/spam rejection does not suppress a person as an invalid address.

## Controlled test

Send only to kubilaykuplay@gmail.com using the existing Kubilay customer and Perla Z2 test unit. Do not send to the whole project as part of implementation verification. In Gmail, use Show original to inspect SPF, DKIM, DMARC, inbox placement and rendering. A local SMTP authentication check alone is insufficient.

## CRM rollout and current paused campaign

Backend supports persisted subject/language for each recipient, exact unit snapshot history, and durable campaign pause/resume. AFTERSALES can read the same campaign tracking as ADMIN/MANAGER. Authorized units are checked before loading email history; historical email is filtered to the current customer and exact unit snapshot. SENT means SMTP acceptance.

Approved Perla subjects are built from CRM project + all recipient units, e.g. `La Joya Perla A-2` or `La Joya Perla A-2, B-10`. The approved multilingual body stays unchanged. Subject and language are persisted before sending and remain visible after the job payload is cleared.

Apply both queue and subject/pause migrations before deploying backend, then deploy frontend. The subject/pause migration pauses existing SENDING campaigns. Deploy cannot resume those campaigns automatically. Never re-create the current campaign or resend its SENT recipients to apply a new subject.

For the approved campaign, provider hourly cap was confirmed as 250 and this application is deliberately allocated 100/hour, 36 seconds apart. Deployment settings can use:

```
BULK_EMAIL_QUEUE_ENABLED=true
BULK_EMAIL_HOURLY_LIMIT=100
BULK_EMAIL_DAILY_LIMIT=300
BULK_EMAIL_INTERVAL_SECONDS=36
```

300/day is an application cap for this one campaign, not a newly verified provider daily quota. The existing campaign remains paused even when these settings are enabled. Only explicit Resume in the authenticated CRM clears its pausedAt flag. Do not use the old one-off local runner after this rollout; it was stopped and retained locally for audit only.

The operator has NOT authorized resumption after the subject edit. Current pause must remain until that instruction arrives. Emailless and shared-address records appear as MISSING_EMAIL and SKIPPED in the same campaign; no SMTP jobs exist for them.
