import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { PaymentTrackingStoreService } from '../src/payment-tracking/payment-tracking-store.service';
import { PaymentTrackingService } from '../src/payment-tracking/payment-tracking.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Read-only diagnosis: never print credentials, tokens, identities or balances.
async function main() {
  const settings = { ...parse(readFileSync(resolve('.env'))), ...process.env };
  for (const [key, value] of Object.entries(settings))
    if (value !== undefined) process.env[key] = value;
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const prisma = new PrismaService();
  const db = prisma as unknown as PrismaClient;
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  const store = new PaymentTrackingStoreService(prisma);
  const service = new PaymentTrackingService(source, store);
  async function measure<T>(stage: string, read: () => Promise<T>) {
    const started = Date.now();
    try {
      const value = await read();
      console.log(
        JSON.stringify({ stage, ok: true, ms: Date.now() - started }),
      );
      return value;
    } catch (error: unknown) {
      process.exitCode = 1;
      const failure = error as {
        code?: string;
        name?: string;
        response?: { code?: string };
      };
      console.log(
        JSON.stringify({
          stage,
          ok: false,
          ms: Date.now() - started,
          code: failure.response?.code ?? failure.code ?? failure.name,
        }),
      );
      return null;
    }
  }
  try {
    const [snapshot, actor] = await Promise.all([
      measure('logoSnapshot', () => source.snapshot(true)),
      measure('crmActor', () =>
        db.user.findFirst({
          where: { isActive: true, role: 'ADMIN' },
          select: { id: true, role: true },
        }),
      ),
    ]);
    if (snapshot)
      console.log(
        JSON.stringify({
          stage: 'logoResult',
          asOf: snapshot.asOf,
          recordCount: snapshot.recordCount,
          cases: snapshot.cases.length,
          audit: snapshot.audit?.status,
          authorization: snapshot.authorizationSource.status,
        }),
      );
    await measure('crmTrackingStates', () => store.getMany());
    await measure('crmAssignees', () => store.assignables());
    if (actor) {
      const query = {
        scope: 'actionable',
        paymentKind: 'sale',
        authorizationState: 'blank',
      };
      const list = await measure('serviceList', () =>
        service.list(actor, query),
      );
      if (list)
        console.log(
          JSON.stringify({
            stage: 'listResult',
            total: list.total,
            rows: list.rows.length,
            currency: list.selectedCurrency,
            audit: list.source.audit?.status,
          }),
        );
      if (settings.JWT_ACCESS_SECRET) {
        const token = await new JwtService().signAsync(
          { sub: actor.id, role: actor.role },
          { secret: settings.JWT_ACCESS_SECRET, expiresIn: '90s' },
        );
        await measure('runningHttpApi', async () => {
          const response = await fetch(
            `http://localhost:3002/payment-tracking?${new URLSearchParams(query)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(45_000),
            },
          );
          const body = (await response.json()) as {
            code?: string;
            message?: string;
            total?: number;
            rows?: unknown[];
            source?: { generatedAt?: string; audit?: { status?: string } };
          };
          console.log(
            JSON.stringify({
              stage: 'httpResult',
              status: response.status,
              code: body.code,
              message: !response.ok ? body.message : undefined,
              total: body.total,
              rows: body.rows?.length,
              generatedAt: body.source?.generatedAt,
              audit: body.source?.audit?.status,
            }),
          );
          if (!response.ok) process.exitCode = 1;
        });
      }
    }
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
    await prisma.onModuleDestroy();
  }
}
main().catch(() => {
  console.error('PAYMENT_READ_DIAGNOSIS_FAILED');
  process.exitCode = 1;
});
