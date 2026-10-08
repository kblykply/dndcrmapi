import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

export type ItUser = {
  id: string;
  role: string;
  originalRole?: string;
  isPreview?: boolean;
};
export const employeeRoles = [
  'ADMIN',
  'MANAGER',
  'SALES',
  'CALLCENTER',
  'AFTERSALES',
  'ACCOUNTING',
];
export function assertItIdentity(user?: ItUser): asserts user is ItUser {
  if (!user?.id || !user.role)
    throw new UnauthorizedException('Please sign in.');
  if (
    !employeeRoles.includes(user.role) ||
    user.originalRole === 'PREVIEW' ||
    user.isPreview
  )
    throw new ForbiddenException('Preview accounts cannot access IT support.');
}
@Injectable()
export class ItSupportGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    assertItIdentity(context.switchToHttp().getRequest().user);
    return true;
  }
}
