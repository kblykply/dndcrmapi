import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import type { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(private jwtService: JwtService) {}

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        this.extractBearer(client.handshake.headers?.authorization);

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || "dev-secret-change-me",
      });

      const userId = payload?.sub;
      if (!userId) {
        client.disconnect();
        return;
      }

      client.data.userId = userId;
      await client.join(this.getUserRoom(userId));
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      client.leave(this.getUserRoom(userId));
    }
  }

  @SubscribeMessage("notifications:join")
  async joinOwnRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userId?: string },
  ) {
    const socketUserId = client.data?.userId;
    if (!socketUserId) return { ok: false };

    if (body?.userId && body.userId !== socketUserId) {
      return { ok: false, message: "No access" };
    }

    await client.join(this.getUserRoom(socketUserId));
    return { ok: true };
  }

  emitNotificationToUser(userId: string, notification: any) {
    this.server
      .to(this.getUserRoom(userId))
      .emit("notification:new", notification);
  }

  emitUnreadCount(userId: string, unread: number) {
    this.server
      .to(this.getUserRoom(userId))
      .emit("notification:unread-count", { unread });
  }

  emitNotificationRead(userId: string, notificationId: string) {
    this.server
      .to(this.getUserRoom(userId))
      .emit("notification:read", { id: notificationId });
  }

  emitNotificationDeleted(userId: string, notificationId: string) {
    this.server
      .to(this.getUserRoom(userId))
      .emit("notification:deleted", { id: notificationId });
  }

  private extractBearer(authorization?: string | string[]) {
    if (!authorization) return null;
    const value = Array.isArray(authorization)
      ? authorization[0]
      : authorization;

    if (!value?.startsWith("Bearer ")) return null;
    return value.slice(7);
  }
}