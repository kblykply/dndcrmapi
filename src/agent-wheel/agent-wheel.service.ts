import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PROJECT_LABELS,
  PROJECT_TYPES,
  isProjectType,
} from '../common/projects';
import type { Role } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_WHEEL_PRIZES, pickAgentWheelPrize } from './agent-wheel.catalog';

type ReqUser = {
  id: string;
  role: Role;
  email: string;
};

type SpinInput = {
  customerId?: string | null;
  unitSelectionId?: string | null;
  agencyId?: string | null;
};

type ListSpinQuery = {
  q?: string | null;
  spunById?: string | null;
  agencyId?: string | null;
  saleType?: string | null;
  project?: string | null;
  prizeId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export function splitUnitAddress(unitNumber: string) {
  const value = String(unitNumber || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!value) return { block: null, apartment: '' };

  const namedBlock = value.match(
    /^(?:BLOK|BLOCK)\s+([A-ZÇĞİÖŞÜ0-9]+)(?:\s*[-/]\s*|\s+)(.+)$/iu,
  );
  if (namedBlock) {
    return {
      block: namedBlock[1].toLocaleUpperCase('tr-TR'),
      apartment: namedBlock[2].trim(),
    };
  }

  const compact = value.match(/^([A-ZÇĞİÖŞÜ]+)\s*-?\s*(\d.*)$/iu);
  if (compact) {
    return {
      block: compact[1].toLocaleUpperCase('tr-TR'),
      apartment: compact[2].trim(),
    };
  }

  return { block: null, apartment: value };
}

@Injectable()
export class AgentWheelService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(value?: string | null) {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private assertWheelUser(user: ReqUser) {
    if (!user || !['ADMIN', 'MANAGER', 'SALES'].includes(user.role)) {
      throw new ForbiddenException('No access to the agent wheel');
    }
  }

  private assertManagementUser(user: ReqUser) {
    if (!user || !['ADMIN', 'MANAGER'].includes(user.role)) {
      throw new ForbiddenException(
        'Only admin and manager can view wheel records',
      );
    }
  }

  private parseDate(value: string | null, field: string, endOfDay = false) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is invalid`);
    }
    if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }

  async getOptions(user: ReqUser) {
    this.assertWheelUser(user);

    const [currentUser, agencies, customers] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      }),
      this.prisma.agency.findMany({
        where: { status: { not: 'CLOSED' } },
        select: {
          id: true,
          name: true,
          status: true,
          assignedSalesId: true,
          assignedSales: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.findMany({
        where: {
          type: 'EXISTING',
          unitSelections: { some: { isCanceled: false } },
        },
        select: {
          id: true,
          fullName: true,
          companyName: true,
          agencyId: true,
          ownerId: true,
          owner: { select: { id: true, name: true } },
          unitSelections: {
            where: { isCanceled: false },
            select: {
              id: true,
              project: true,
              unitNumber: true,
              agentWheelSpin: {
                select: {
                  id: true,
                  prizeId: true,
                  prizeNameTr: true,
                  createdAt: true,
                },
              },
            },
            orderBy: [{ project: 'asc' }, { unitNumber: 'asc' }],
          },
        },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    if (!currentUser?.isActive) {
      throw new ForbiddenException('User account is inactive');
    }

    return {
      currentUser: {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
      },
      agencies,
      customers: customers.map((customer) => ({
        ...customer,
        unitSelections: customer.unitSelections.map((unit) => {
          const address = splitUnitAddress(unit.unitNumber);
          return {
            id: unit.id,
            project: unit.project,
            unitNumber: unit.unitNumber,
            block: address.block,
            apartment: address.apartment,
            alreadySpun: Boolean(unit.agentWheelSpin),
            previousSpin: unit.agentWheelSpin,
          };
        }),
      })),
    };
  }

  async spin(user: ReqUser, input: SpinInput) {
    this.assertWheelUser(user);

    const customerId = this.clean(input.customerId);
    const unitSelectionId = this.clean(input.unitSelectionId);
    const agencyId = this.clean(input.agencyId);

    if (!customerId) throw new BadRequestException('Customer is required');
    if (!unitSelectionId) throw new BadRequestException('Unit is required');

    const [spinner, unit, agency, previousSpin] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      }),
      this.prisma.customerUnitSelection.findUnique({
        where: { id: unitSelectionId },
        select: {
          id: true,
          customerId: true,
          project: true,
          unitNumber: true,
          isCanceled: true,
          customer: {
            select: {
              id: true,
              fullName: true,
              type: true,
            },
          },
        },
      }),
      agencyId
        ? this.prisma.agency.findUnique({
            where: { id: agencyId },
            select: { id: true, name: true, status: true },
          })
        : Promise.resolve(null),
      this.prisma.agentWheelSpin.findUnique({
        where: { unitSelectionKey: unitSelectionId },
        select: {
          id: true,
          prizeId: true,
          prizeNameTr: true,
          createdAt: true,
        },
      }),
    ]);

    if (!spinner?.isActive) {
      throw new ForbiddenException('User account is inactive');
    }
    if (!unit) throw new NotFoundException('Selected unit was not found');
    if (unit.customerId !== customerId) {
      throw new BadRequestException(
        'Selected unit does not belong to this customer',
      );
    }
    if (unit.isCanceled) {
      throw new BadRequestException(
        'Canceled units cannot be used for the wheel',
      );
    }
    if (unit.customer.type !== 'EXISTING') {
      throw new BadRequestException(
        'The wheel requires an existing customer sale',
      );
    }
    if (agencyId && !agency)
      throw new NotFoundException('Selected agency was not found');
    if (agency?.status === 'CLOSED') {
      throw new BadRequestException(
        'Closed agencies cannot be used for the wheel',
      );
    }
    if (previousSpin) {
      throw new ConflictException({
        message: 'This sale has already used the wheel',
        previousSpin,
      });
    }

    const prize = pickAgentWheelPrize();
    const address = splitUnitAddress(unit.unitNumber);

    try {
      return await this.prisma.agentWheelSpin.create({
        data: {
          spunById: spinner.id,
          spunByName: spinner.name,
          spunByEmail: spinner.email,
          spunByRole: spinner.role,
          saleType: agency ? 'AGENCY' : 'DIRECT',
          agencyId: agency?.id || null,
          agencyName: agency?.name || null,
          customerId: unit.customer.id,
          customerName: unit.customer.fullName,
          unitSelectionId: unit.id,
          unitSelectionKey: unit.id,
          project: unit.project,
          block: address.block,
          unitNumber: unit.unitNumber,
          prizeId: prize.id,
          prizeNameTr: prize.nameTr,
          prizeNameEn: prize.nameEn,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('This sale has already used the wheel');
      }
      throw error;
    }
  }

  async getManagementOptions(user: ReqUser) {
    this.assertManagementUser(user);

    const [salesUsers, agencies] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: ['ADMIN', 'MANAGER', 'SALES'] },
        },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.agency.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      salesUsers,
      agencies,
      projects: PROJECT_TYPES.map((id) => ({ id, name: PROJECT_LABELS[id] })),
      prizes: AGENT_WHEEL_PRIZES.map((prize) => ({
        id: prize.id,
        nameTr: prize.nameTr,
        nameEn: prize.nameEn,
      })),
    };
  }

  async listSpins(user: ReqUser, query: ListSpinQuery = {}) {
    this.assertManagementUser(user);

    const q = this.clean(query.q);
    const spunById = this.clean(query.spunById);
    const agencyId = this.clean(query.agencyId);
    const saleType = this.clean(query.saleType)?.toUpperCase() || null;
    const project = this.clean(query.project)?.toUpperCase() || null;
    const prizeId = this.clean(query.prizeId);
    const dateFrom = this.parseDate(this.clean(query.dateFrom), 'dateFrom');
    const dateTo = this.parseDate(this.clean(query.dateTo), 'dateTo', true);
    const requestedPage = Number(query.page || 1);
    const requestedPageSize = Number(query.pageSize || 50);

    if (
      !Number.isFinite(requestedPage) ||
      !Number.isFinite(requestedPageSize)
    ) {
      throw new BadRequestException('Invalid pagination');
    }

    const page = Math.max(1, Math.floor(requestedPage));
    const pageSize = Math.min(200, Math.max(1, Math.floor(requestedPageSize)));

    if (saleType && saleType !== 'DIRECT' && saleType !== 'AGENCY') {
      throw new BadRequestException('Invalid sale type');
    }
    if (project && !isProjectType(project)) {
      throw new BadRequestException('Invalid project');
    }
    if (dateFrom && dateTo && dateFrom >= dateTo) {
      throw new BadRequestException('dateFrom cannot be after dateTo');
    }

    const where: any = {};
    if (spunById) where.spunById = spunById;
    if (agencyId) where.agencyId = agencyId;
    if (saleType) where.saleType = saleType;
    if (project) where.project = project;
    if (prizeId) where.prizeId = prizeId;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lt: dateTo } : {}),
      };
    }
    if (q) {
      where.OR = [
        { spunByName: { contains: q, mode: 'insensitive' } },
        { agencyName: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { unitNumber: { contains: q, mode: 'insensitive' } },
        { block: { contains: q, mode: 'insensitive' } },
        { prizeNameTr: { contains: q, mode: 'insensitive' } },
        { prizeNameEn: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total, saleTypeGroups, prizeGroups, projectGroups] =
      await Promise.all([
        this.prisma.agentWheelSpin.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.agentWheelSpin.count({ where }),
        this.prisma.agentWheelSpin.groupBy({
          by: ['saleType'],
          where,
          _count: { _all: true },
        }),
        this.prisma.agentWheelSpin.groupBy({
          by: ['prizeId', 'prizeNameTr', 'prizeNameEn'],
          where,
          _count: { _all: true },
          orderBy: { _count: { prizeId: 'desc' } },
        }),
        this.prisma.agentWheelSpin.groupBy({
          by: ['project'],
          where,
          _count: { _all: true },
        }),
      ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      stats: {
        total,
        direct:
          saleTypeGroups.find((row) => row.saleType === 'DIRECT')?._count
            ._all || 0,
        agency:
          saleTypeGroups.find((row) => row.saleType === 'AGENCY')?._count
            ._all || 0,
        byPrize: prizeGroups.map((row) => ({
          prizeId: row.prizeId,
          prizeNameTr: row.prizeNameTr,
          prizeNameEn: row.prizeNameEn,
          count: row._count._all,
        })),
        byProject: projectGroups.map((row) => ({
          project: row.project,
          count: row._count._all,
        })),
      },
    };
  }
}
