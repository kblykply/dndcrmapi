# Perla email delivery

The approved announcement stays in one email, including cafe, handover and furniture sections.

## Verified authentication and provider limits

The received Gmail test on 2026-10-16 passed SPF, DKIM and DMARC for dndcyprus.com. Turhost is the authoritative DNS/mail provider. DMARC currently uses `p=none`; successful authentication does not guarantee inbox placement. Provider hourly quota is 250 messages. The approved local campaign plan is 100/hour with at least 36 seconds between messages; its 300/day limit is an internal cap, not a confirmed provider daily quota. Other mailbox activity also consumes provider quota.

## Current deployment mode: production tracks, local sends

Deploy backend first, then frontend. Both use the existing shared Supabase database. Keep this setting on **production and the normal local API server**:

```
BULK_EMAIL_QUEUE_ENABLED=false
```

Ava uses the read-only Mail Delivery Tracking screen. It refreshes campaign status every 10 seconds, shows recipient subjects and links to unit communication history. Perla language groups show the approved Turkish → Persian → Russian → English order and estimates at 100/hour; quota waits, other campaigns and retries can extend those estimates. Preview returns the persisted queued HTML with inline images, or saved sent text from unit logs. It never sends an email.

Only a separately invoked local operator process may enable its own worker with the approved limits. Deploying these changes must not start delivery or clear campaign `pausedAt`. Existing SENT jobs must never be recreated. The old `run-approved-perla-20261016.js` runner is retired: its 274-person manifest excludes the later operator addition.

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

For an explicitly authorized local operator process only:

```
BULK_EMAIL_QUEUE_ENABLED=true
BULK_EMAIL_HOURLY_LIMIT=100
BULK_EMAIL_DAILY_LIMIT=300
BULK_EMAIL_INTERVAL_SECONDS=36
```

The CRM no longer exposes send/resume controls. General campaign delivery requires a separate explicit operator instruction. Emailless and shared-address records remain MISSING_EMAIL and SKIPPED; no SMTP jobs exist for them.

## One-recipient check without resuming the campaign

`scripts/send-paused-campaign-check.js` validates an existing paused campaign job, approved Perla content, sender, SMTP authentication and sent-folder access. It is read-only by default; `--send-one` explicitly enables one SMTP submission to the supplied address. It moves that queued job first, uses the same durable queue/rate limits, and verifies that every other recipient is unchanged. It never creates a campaign, starts a scheduler, or clears campaign pause. SENT, UNCERTAIN and previously attempted jobs are refused.

Required arguments: `--campaign ID --email EMAIL --expected-sender EMAIL`. Build the backend before use. The queue method `sendOnePausedJob` is available only to operator code, not an HTTP endpoint or automatic scheduler. Both campaign and exact job IDs are required, and the campaign must still be paused.

The authorized single operator email on 2026-10-16 succeeded: SMTP acceptance, Ava's Sent Items copy, unit history and AFTERSALES tracking were verified. General delivery remains paused awaiting the operator's next instruction.
