import { BadRequestException } from '@nestjs/common';
export function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Geçersiz veri.');
  return body as Record<string, unknown>;
}
export function text(v: unknown, max = 2000, min = 0): string {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max)
    throw new BadRequestException(`Metin ${min}–${max} karakter olmalı.`);
  return v.trim();
}
export function version(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1)
    throw new BadRequestException('Kayıt sürümü gerekli.');
  return v;
}
export function choice(v: unknown, values: string[]): string {
  if (typeof v !== 'string' || !values.includes(v))
    throw new BadRequestException('Geçersiz durum.');
  return v;
}
export function numeric(
  v: unknown,
  { signed = false, nullable = false, max = 100000000000, scale = 6 } = {},
): string | null {
  if (v === null && nullable) return null;
  if (
    (typeof v !== 'string' && typeof v !== 'number') ||
    !new RegExp(`^-?\\d+(?:\\.\\d{1,${scale}})?$`).test(String(v))
  )
    throw new BadRequestException('Geçerli bir sayı girin.');
  const n = Number(v);
  if (!Number.isFinite(n) || (!signed && n < 0) || Math.abs(n) > max)
    throw new BadRequestException('Sayı izin verilen aralık dışında.');
  return String(v);
}
export function day(v: unknown): Date {
  const s = text(v, 10, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    throw new BadRequestException('Geçersiz tarih.');
  return d;
}
