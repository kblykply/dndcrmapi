import 'reflect-metadata';
import { ForbiddenException, StreamableFile, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Iso2026Controller } from './iso-2026.controller';
import { Iso2026Service } from './iso-2026.service';

const writes = ['update', 'createChecklist', 'updateChecklist', 'deleteChecklist', 'createDocument', 'updateDocument', 'deleteDocument', 'addLog'] as const;
function context(method: keyof Iso2026Controller, role?: string, verb = 'GET') {
  return {
    getHandler: () => Iso2026Controller.prototype[method],
    getClass: () => Iso2026Controller,
    switchToHttp: () => ({ getRequest: () => ({ method: verb, user: role ? { id: 'actor', role } : undefined }) }),
  } as any;
}

describe('ISO 2026 protected routes', () => {
  const guard = new RolesGuard(new Reflector());
  it('requires the JWT guard and role guard on every controller route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, Iso2026Controller)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(() => guard.canActivate(context('list'))).toThrow(UnauthorizedException);
  });
  it.each(['list', 'get', 'pdf'] as const)('allows preview reads on %s while excluding accounting and callcenter', (method) => {
    expect(guard.canActivate(context(method, 'PREVIEW'))).toBe(true);
    for (const role of ['ACCOUNTING', 'CALLCENTER']) expect(() => guard.canActivate(context(method, role))).toThrow(ForbiddenException);
  });
  it.each(writes)('blocks preview mutations on %s while allowing the four editing roles', (method) => {
    for (const role of ['PREVIEW', 'ACCOUNTING', 'CALLCENTER']) expect(() => guard.canActivate(context(method, role, 'POST'))).toThrow(ForbiddenException);
    for (const role of ['ADMIN', 'MANAGER', 'SALES', 'AFTERSALES']) expect(guard.canActivate(context(method, role, 'POST'))).toBe(true);
  });
  it('serves the protected PDF as a private binary response on its dedicated static route', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, Iso2026Controller.prototype.pdf)).toBe('source/pdf');
    const service = { sourcePdf: jest.fn(async () => Buffer.from('%PDF-1.7 fixture')) };
    const controller = new Iso2026Controller(service as unknown as Iso2026Service);
    const headers = { setHeader: jest.fn() };
    const user = { id: 'actor', role: 'PREVIEW' };
    const file = await controller.pdf({ user }, headers as any);
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toMatchObject({ type: 'application/pdf', disposition: 'inline; filename="ISO_9001_2026.pdf"' });
    expect(headers.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(headers.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(service.sourcePdf).toHaveBeenCalledWith(user);
  });
});
