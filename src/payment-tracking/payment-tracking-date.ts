import { BadRequestException } from '@nestjs/common';

export function paymentTrackingDate(value: string, field: string): Date {
  const invalid = (message: string): never => {
    throw new BadRequestException({
      code: 'PAYMENT_TRACKING_INVALID',
      message,
    });
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return invalid(`${field} YYYY-MM-DD biçiminde olmalı.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    date.getUTCFullYear() < 1753 ||
    date.getUTCFullYear() > 9998
  )
    return invalid(`${field} geçerli bir tarih olmalı (1753–9998).`);
  return date;
}

export function paymentTrackingToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Famagusta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
