import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Role } from "../common/types";

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type CreateOrgChartNodeDto = {
  name: string;
  type?: string | null;
  color?: string | null;
  parentId?: string | null;
  order?: number;
};

type UpdateOrgChartNodeDto = {
  name?: string;
  type?: string | null;
  color?: string | null;
  parentId?: string | null;
  order?: number;
};

export type OrgChartTreeNode = {
      id: string;
  name: string;
  type: string | null;
  color: string | null;
  parentId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  children: OrgChartTreeNode[];
};

@Injectable()
export class OrgChartService {
  constructor(private prisma: PrismaService) {}

  private ensureAuth(user: ReqUser) {
    if (!user?.id) {
      throw new ForbiddenException("Unauthorized");
    }
  }

  private canEdit(user: ReqUser) {
    return user.role === "ADMIN" || user.role === "MANAGER";
  }

  private cleanStr(v?: string | null) {
    const x = String(v ?? "").trim();
    return x || null;
  }

  private toSafeOrder(value: unknown, fallback = 0) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const n = Number(value);

    if (!Number.isFinite(n)) {
      throw new BadRequestException("Invalid order");
    }

    return Math.floor(n);
  }

  private async getNodeOrThrow(id: string) {
    const node = await this.prisma.orgChartNode.findUnique({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException("Org chart node not found");
    }

    return node;
  }

  private async assertParentExists(parentId?: string | null) {
    if (!parentId) return null;

    const parent = await this.prisma.orgChartNode.findUnique({
      where: { id: parentId },
      select: { id: true },
    });

    if (!parent) {
      throw new BadRequestException("Parent node not found");
    }

    return parent;
  }

  private buildTree(rows: any[]): OrgChartTreeNode[] {
    const map = new Map<string, OrgChartTreeNode>();

    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.type ?? null,
        color: row.color ?? null,
        parentId: row.parentId ?? null,
        order: row.order ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        children: [],
      });
    }

    const roots: OrgChartTreeNode[] = [];

    for (const row of rows) {
      const current = map.get(row.id)!;

      if (row.parentId && map.has(row.parentId)) {
        map.get(row.parentId)!.children.push(current);
      } else {
        roots.push(current);
      }
    }

    const sortRecursive = (nodes: OrgChartTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });

      for (const node of nodes) {
        sortRecursive(node.children);
      }
    };

    sortRecursive(roots);

    return roots;
  }

  private async assertNoCycle(nodeId: string, nextParentId?: string | null) {
    if (!nextParentId) return;

    if (nodeId === nextParentId) {
      throw new BadRequestException("A node cannot be its own parent");
    }

    let currentParentId: string | null | undefined = nextParentId;

    while (currentParentId) {
      if (currentParentId === nodeId) {
        throw new BadRequestException("Invalid parent: cycle detected");
      }

      const parent = await this.prisma.orgChartNode.findUnique({
        where: { id: currentParentId },
        select: { parentId: true },
      });

      currentParentId = parent?.parentId ?? null;
    }
  }

  async listFlat(user: ReqUser) {
    this.ensureAuth(user);

    return this.prisma.orgChartNode.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
  }

  async getTree(user: ReqUser) {
    this.ensureAuth(user);

    const rows = await this.prisma.orgChartNode.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return this.buildTree(rows);
  }

  async getOne(user: ReqUser, id: string) {
    this.ensureAuth(user);
    return this.getNodeOrThrow(id);
  }

  async create(user: ReqUser, body: CreateOrgChartNodeDto) {
    this.ensureAuth(user);

    if (!this.canEdit(user)) {
      throw new ForbiddenException("Only manager or admin can create org chart nodes");
    }

    const name = this.cleanStr(body?.name);
    const type = this.cleanStr(body?.type);
    const color = this.cleanStr(body?.color);
    const parentId = this.cleanStr(body?.parentId);
    const order = this.toSafeOrder(body?.order, 0);

    if (!name) {
      throw new BadRequestException("name is required");
    }

    await this.assertParentExists(parentId);

    return this.prisma.orgChartNode.create({
      data: {
        name,
        type,
        color,
        parentId,
        order,
      },
    });
  }

  async update(user: ReqUser, id: string, body: UpdateOrgChartNodeDto) {
    this.ensureAuth(user);

    if (!this.canEdit(user)) {
      throw new ForbiddenException("Only manager or admin can update org chart nodes");
    }

    const existing = await this.getNodeOrThrow(id);

    const data: Record<string, any> = {};

    if (body.name !== undefined) {
      const name = this.cleanStr(body.name);
      if (!name) {
        throw new BadRequestException("name is required");
      }
      data.name = name;
    }

    if (body.type !== undefined) {
      data.type = this.cleanStr(body.type);
    }

    if (body.color !== undefined) {
      data.color = this.cleanStr(body.color);
    }

    if (body.order !== undefined) {
      data.order = this.toSafeOrder(body.order, existing.order ?? 0);
    }

    if (body.parentId !== undefined) {
      const nextParentId = this.cleanStr(body.parentId);

      await this.assertParentExists(nextParentId);
      await this.assertNoCycle(id, nextParentId);

      data.parentId = nextParentId;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No valid fields to update");
    }

    return this.prisma.orgChartNode.update({
      where: { id },
      data,
    });
  }

  async remove(user: ReqUser, id: string) {
    this.ensureAuth(user);

    if (!this.canEdit(user)) {
      throw new ForbiddenException("Only manager or admin can delete org chart nodes");
    }

    await this.getNodeOrThrow(id);

    await this.prisma.orgChartNode.delete({
      where: { id },
    });

    return { success: true };
  }
}