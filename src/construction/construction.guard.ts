import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
export type ConstructionUser = {
  id: string;
  role: string;
  isPreview?: boolean;
  originalRole?: string;
};
export function assertConstructionAccess(
  user?: ConstructionUser,
  write = false,
) {
  if (!user?.id) throw new UnauthorizedException();
  if (
    user.isPreview ||
    user.originalRole === 'PREVIEW' ||
    !['ADMIN', 'ACCOUNTING'].includes(user.role) ||
    (write && user.role !== 'ADMIN')
  )
    throw new ForbiddenException(
      'İnşaat erişimi: ADMIN düzenler, ACCOUNTING görüntüler.',
    );
}
@Injectable()
export class ConstructionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user: ConstructionUser; method: string }>();
    assertConstructionAccess(req.user, req.method !== 'GET');
    return true;
  }
}
