import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty,
  IsOptional, IsString, Matches, MaxLength, Min, ValidateNested,
} from "class-validator";
import { OrgNodeKind, OrgProcessResponsibility } from "@prisma/client";

export class OrgProcessDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  cardId!: string;

  @IsEnum(OrgProcessResponsibility)
  responsibility!: OrgProcessResponsibility;
}

export class OrgDefinitionDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  name!: string;

  @IsEnum(OrgNodeKind)
  kind!: OrgNodeKind;

  @IsOptional() @IsString() @MaxLength(60)
  code?: string | null;

  @IsOptional() @IsString() @MaxLength(100)
  parentId?: string | null;

  @IsOptional() @IsInt() @Min(0)
  order?: number;

  @IsOptional() @IsString() @MaxLength(10000)
  purpose?: string | null;

  @IsOptional() @IsString() @MaxLength(20000)
  responsibilities?: string | null;

  @IsOptional() @IsString() @MaxLength(10000)
  authority?: string | null;

  @IsOptional() @IsString() @MaxLength(10000)
  competencies?: string | null;

  @IsOptional() @IsString() @MaxLength(10000)
  performanceIndicators?: string | null;

  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reviewDueAt?: string | null;

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrgProcessDto)
  processes!: OrgProcessDto[];

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class UpdateOrgDefinitionDto extends OrgDefinitionDto {
  @IsInt() @Min(1)
  version!: number;
}

export class OrgActionDto {
  @IsInt() @Min(1)
  version!: number;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;
}

export class OrgAssignmentDto extends OrgActionDto {
  // Null explicitly removes the current assignment.
  @IsOptional() @IsString() @MaxLength(100)
  userId?: string | null;
}
