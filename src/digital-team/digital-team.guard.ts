import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

export type DigitalTeamUser = {
  id: string;
  role: string;
  originalRole?: string;
  isPreview?: boolean;
};

export function assertDigitalTeamIdentity(
  user?: DigitalTeamUser,
): asserts user is DigitalTeamUser {
  if (!user?.id || !user.role)
    throw new UnauthorizedException('Please sign in.');
  if (
    user.role !== 'ADMIN' ||
    user.originalRole === 'PREVIEW' ||
    user.isPreview
  ) {
    throw new ForbiddenException(
      'Digital Team is restricted to administrator accounts.',
    );
  }
}

@Injectable()
export class DigitalTeamGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    assertDigitalTeamIdentity(
      context.switchToHttp().getRequest<{ user?: DigitalTeamUser }>().user,
    );
    return true;
  }
}
