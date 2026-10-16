export function normalizeRecipientEmail(value?: string | null): string | null {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email)
  )
    return null;
  return email;
}

export function mailFailure(error: any): {
  retry: boolean;
  suppress: boolean;
  uncertain: boolean;
} {
  const response = Number(error?.responseCode || 0);
  const command = String(error?.command || "").toUpperCase();
  const definitive = response >= 400 && response < 600;
  // After DATA, a lost acknowledgement can mean the message was accepted.
  const uncertain =
    !definitive &&
    ![
      "CONN",
      "CONNECT",
      "EHLO",
      "AUTH",
      "AUTH PLAIN",
      "AUTH LOGIN",
      "RCPT TO",
      "MAIL FROM",
    ].includes(command);
  return {
    retry:
      !uncertain &&
      ((response >= 400 && response < 500) ||
        ["ECONNECTION", "ECONNREFUSED", "EDNS"].includes(error?.code)),
    suppress:
      command === "RCPT TO" &&
      /5\.1\.[1236]\b/.test(String(error?.response || "")),
    uncertain,
  };
}

export function queuePolicy(env: NodeJS.ProcessEnv = process.env) {
  const hourly = Number(env.BULK_EMAIL_HOURLY_LIMIT);
  const daily = Number(env.BULK_EMAIL_DAILY_LIMIT);
  const interval = Number(env.BULK_EMAIL_INTERVAL_SECONDS || 60);
  return {
    enabled:
      env.BULK_EMAIL_QUEUE_ENABLED === "true" &&
      Number.isInteger(hourly) &&
      hourly > 0 &&
      Number.isInteger(daily) &&
      daily > 0 &&
      Number.isFinite(interval) &&
      interval >= 10,
    hourly,
    daily,
    interval,
  };
}
