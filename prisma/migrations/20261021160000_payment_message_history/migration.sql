BEGIN;
ALTER TABLE "PaymentTrackingEvent"
  ADD COLUMN "message" JSONB,
  ADD COLUMN "requestId" VARCHAR(64);
CREATE UNIQUE INDEX "PaymentTrackingEvent_requestId_key" ON "PaymentTrackingEvent"("requestId");
ALTER TABLE "PaymentTrackingEvent" DROP CONSTRAINT "PaymentTrackingEvent_type_check";
ALTER TABLE "PaymentTrackingEvent" ADD CONSTRAINT "PaymentTrackingEvent_type_check"
  CHECK ("type" IN ('defer','reset','note','assign','priority','contact','message_draft','message_sent'));
ALTER TABLE "PaymentTrackingEvent" DROP CONSTRAINT "PaymentTrackingEvent_body_check";
ALTER TABLE "PaymentTrackingEvent" ADD CONSTRAINT "PaymentTrackingEvent_body_check"
  CHECK ("body" IS NULL OR char_length("body") <= CASE WHEN "type" IN ('message_draft','message_sent') THEN 4000 ELSE 2000 END);
ALTER TABLE "PaymentTrackingEvent" ADD CONSTRAINT "PaymentTrackingEvent_message_check"
  CHECK ("type" NOT IN ('message_draft','message_sent') OR
    ("message" IS NOT NULL AND jsonb_typeof("message") = 'object' AND "requestId" IS NOT NULL
      AND "channel" IS NOT NULL AND "channel" IN ('email','whatsapp') AND "body" IS NOT NULL));
COMMIT;
