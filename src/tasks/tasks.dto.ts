import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CrmTaskPriority,
  CrmTaskStatus,
  WorkItemKind,
  WorkMemberRole,
} from '@prisma/client';

export class TaskQueryDto {
  @IsOptional() @IsEnum(CrmTaskStatus) status?: CrmTaskStatus;
  @IsOptional() @IsEnum(CrmTaskPriority) priority?: CrmTaskPriority;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @IsString() @MaxLength(100) projectId?: string;
  @IsOptional() @IsString() @MaxLength(100) assignedToId?: string;
  @IsOptional() @IsString() @MaxLength(100) agencyId?: string;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsOptional() @IsString() @MaxLength(100) departmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @Matches(/^(my|created|watching|all)$/) scope?: string;
  @IsOptional() @Matches(/^(today|week|overdue|all)$/) range?: string;
  @IsOptional() @Matches(/^(true|false)$/) archived?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take = 100;
}

export class TaskFieldsDto {
  @ValidateIf((_o, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  title?: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string | null;
  @ValidateIf((_o, value) => value !== undefined)
  @IsEnum(CrmTaskStatus)
  status?: CrmTaskStatus;
  @ValidateIf((_o, value) => value !== undefined)
  @IsEnum(CrmTaskPriority)
  priority?: CrmTaskPriority;
  @ValidateIf((_o, value) => value !== undefined)
  @IsEnum(WorkItemKind)
  kind?: WorkItemKind;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @ValidateIf((_o, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(1000000)
  estimateMinutes?: number;
  @ValidateIf((_o, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];
  @IsOptional() @IsString() @MaxLength(100) assignedToId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) leadId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) agencyId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string | null;
}

export class CreateTaskDto extends TaskFieldsDto {
  @IsString() @Matches(/\S/) @MaxLength(240) declare title: string;
  @IsOptional() @IsString() @MaxLength(100) projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) parentId?: string | null;
}
export class VersionDto {
  @IsInt() @Min(1) version!: number;
}
export class UpdateTaskDto extends TaskFieldsDto {
  @IsInt() @Min(1) version!: number;
}
export class MemberDto {
  @IsString() @IsNotEmpty() @MaxLength(100) userId!: string;
  @IsEnum(WorkMemberRole) role!: WorkMemberRole;
}
export class ProjectDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9]{1,9}$/) key!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color!: string;
  @IsOptional() @IsString() @MaxLength(100) departmentId?: string | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MemberDto)
  members!: MemberDto[];
}
export class UpdateProjectDto extends ProjectDto {
  @IsInt() @Min(1) version!: number;
}
export class ArchiveDto extends VersionDto {
  @IsBoolean() archived!: boolean;
}
export class CommentDto extends VersionDto {
  @IsString() @Matches(/\S/) @MaxLength(10000) body!: string;
}
export class ChecklistDto extends VersionDto {
  @IsString() @Matches(/\S/) @MaxLength(500) title!: string;
  @IsBoolean() done!: boolean;
}
export class DependencyDto extends VersionDto {
  @IsString() @IsNotEmpty() @MaxLength(100) blockerId!: string;
}
export class TimeEntryDto extends VersionDto {
  @IsInt() @Min(1) @Max(1440) minutes!: number;
  @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) workedOn!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}
export class WatchDto {
  @IsBoolean() watching!: boolean;
}
export class BulkItemDto extends VersionDto {
  @IsString() @MaxLength(100) id!: string;
}
export class BulkTaskDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkItemDto)
  items!: BulkItemDto[];
  @ValidateIf((_o, value) => value !== undefined)
  @IsEnum(CrmTaskStatus)
  status?: CrmTaskStatus;
  @ValidateIf((_o, value) => value !== undefined)
  @IsEnum(CrmTaskPriority)
  priority?: CrmTaskPriority;
  @IsOptional() @IsString() @MaxLength(100) assignedToId?: string | null;
}
