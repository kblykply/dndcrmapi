import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export function databaseFailure(
  error: unknown,
): { status: number; code: string; message: string } | null {
  const e = error as { code?: string; name?: string; message?: string };
  if (
    [
      'P1001',
      'P1002',
      'P1008',
      'P1017',
      'P2024',
      'P2037',
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      '53300',
      '57P01',
    ].includes(e?.code || '') ||
    (e?.code === 'P2028' &&
      /time|closed|start a transaction/i.test(e.message || ''))
  ) {
    return {
      status: 503,
      code: 'DATABASE_BUSY',
      message:
        'The database is temporarily unavailable. Please refresh before retrying.',
    };
  }
  if (e?.code === 'P2002')
    return {
      status: 409,
      code: 'DUPLICATE_RECORD',
      message: 'A record with these values already exists.',
    };
  if (e?.code === 'P2025')
    return {
      status: 404,
      code: 'RECORD_NOT_FOUND',
      message: 'The record no longer exists.',
    };
  if (e?.code === 'P2003')
    return {
      status: 409,
      code: 'RECORD_IN_USE',
      message:
        'This record is linked to another record. Refresh and check its references.',
    };
  if (e?.code === 'P2034')
    return {
      status: 409,
      code: 'WRITE_CONFLICT',
      message:
        'Another change was made at the same time. Refresh before saving.',
    };
  return null;
}

@Catch()
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) return;
    if (error instanceof HttpException) {
      const body = error.getResponse();
      res
        .status(error.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode: error.getStatus(), message: body }
            : body,
        );
      return;
    }
    const requestId = randomUUID();
    const req = ctx.getRequest<Request>();
    const e = error as { code?: string; name?: string; stack?: string };
    const failure = databaseFailure(error);
    // Do not log request bodies, SQL, credentials or customer data.
    this.logger.error(
      JSON.stringify({
        requestId,
        method: req.method,
        path: req.route?.path || req.path,
        errorCode: e?.code,
        errorType: e?.name,
        location: e?.stack
          ?.split('\n')
          .find((line) => line.trim().startsWith('at '))
          ?.trim(),
      }),
    );
    res.status(failure?.status || 500).json({
      statusCode: failure?.status || 500,
      code: failure?.code || 'INTERNAL_ERROR',
      message:
        failure?.message ||
        'An unexpected error occurred. Please share the reference with support.',
      requestId,
    });
  }
}
