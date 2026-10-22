import type { PrismaClient } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentContact, PaymentIdentity } from './payment-tracking.types';

interface ContactCustomer {
  oldCustomerCode: string | null;
  oldCariCodes: string | null;
  email: string | null;
  phone: string | null;
  unitSelections: { project: string; unitNumber: string }[];
}

const projects: Record<string, string> = {
  LJ: 'LA_JOYA',
  LJP: 'LA_JOYA_PERLA',
  LJP2: 'LA_JOYA_PERLA_II',
  LV: 'LAGOON_VERDE',
};

function codes(value: string | null): string[] {
  return (value ?? '')
    .split(/[|;,\n\r]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function blank(value: string | null): boolean {
  return !value?.trim() || /^[-–—]+$/.test(value.trim());
}

function email(value: string | null): string | null {
  const text = value?.trim();
  return text && /^[^\s@|;,]+@[^\s@|;,]+\.[^\s@|;,]+$/.test(text) ? text : null;
}

function phone(value: string | null): string | null {
  const text = value?.trim();
  const digits = text?.replace(/\D/g, '') ?? '';
  // Do not guess a country code or choose between multiple numbers.
  return text &&
    /^[+\d ().-]+$/.test(text) &&
    digits.length >= 7 &&
    digits.length <= 15 &&
    !/^(\d)\1+$/.test(digits)
    ? text
    : null;
}

function unitMatches(
  identity: PaymentIdentity,
  customer: ContactCustomer,
): boolean {
  const unit = /^(LJP2|LJP|LJ|LV)-([A-Z]\d+[A-Z]?(?:-[A-Z]\d+[A-Z]?)*)$/.exec(
    identity.unitCode?.trim().toUpperCase() ?? '',
  );
  // Unknown unit formats cannot be compared; exact customer code is still required.
  if (!unit) return true;
  const numbers = unit[2].split('-');
  return numbers.every((number) =>
    customer.unitSelections.some(
      (selection) =>
        selection.project === projects[unit[1]] &&
        selection.unitNumber.trim().toUpperCase().replace(/[\s-]/g, '') ===
          number,
    ),
  );
}

/** Read-time enrichment only. Never writes to either CRM or Logo snapshot tables. */
@Injectable()
export class PaymentTrackingContactService {
  private readonly logger = new Logger(PaymentTrackingContactService.name);
  constructor(private readonly prisma: PrismaService) {}

  async complete(
    logo: PaymentContact,
    identity: PaymentIdentity,
  ): Promise<PaymentContact> {
    // Missing and uncertain are different: never override an ambiguous/failed Logo read.
    if (logo.status === 'ambiguous' || logo.status === 'unavailable')
      return logo;
    const needEmail = blank(logo.email);
    const needPhone = blank(logo.phone);
    const code = identity.customerCode;
    if ((!needEmail && !needPhone) || !code?.trim()) return logo;
    try {
      const candidates: ContactCustomer[] = await (
        this.prisma as unknown as PrismaClient
      ).customer.findMany({
        where: {
          OR: [
            { oldCustomerCode: { contains: code } },
            { oldCariCodes: { contains: code } },
          ],
        },
        select: {
          oldCustomerCode: true,
          oldCariCodes: true,
          email: true,
          phone: true,
          unitSelections: {
            where: { isCanceled: false },
            select: { project: true, unitNumber: true },
          },
        },
      });
      // contains is only a DB prefilter. Never match prefixes, casing variants or names.
      const matches = candidates.filter((customer) =>
        [
          ...codes(customer.oldCustomerCode),
          ...codes(customer.oldCariCodes),
        ].includes(code),
      );
      if (!matches.length) return logo;
      if (matches.length !== 1)
        return { ...logo, crmFallbackStatus: 'ambiguous' };
      const customer = matches[0];
      if (!unitMatches(identity, customer))
        return { ...logo, crmFallbackStatus: 'unit_mismatch' };
      const crmEmail = needEmail ? email(customer.email) : null;
      const crmPhone = needPhone ? phone(customer.phone) : null;
      if (!crmEmail && !crmPhone) return logo;
      const resolvedEmail = crmEmail ?? logo.email;
      const resolvedPhone = crmPhone ?? logo.phone;
      return {
        ...logo,
        email: resolvedEmail,
        phone: resolvedPhone,
        emailSource: crmEmail ? 'crm' : !blank(logo.email) ? 'logo' : null,
        phoneSource: crmPhone ? 'crm' : !blank(logo.phone) ? 'logo' : null,
        status: 'matched',
        crmFallbackStatus: 'matched',
        source:
          !needEmail || !needPhone
            ? 'Logo + CRM · tam cari kodu eşleşmesi'
            : 'CRM · tam cari kodu eşleşmesi',
      };
    } catch {
      this.logger.warn(
        'CRM contact fallback could not be read; preserving Logo contact.',
      );
      return { ...logo, crmFallbackStatus: 'unavailable' };
    }
  }
}
