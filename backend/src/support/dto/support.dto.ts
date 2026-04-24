import { IsString, IsOptional, IsEnum, IsArray, MaxLength, MinLength } from 'class-validator';

export enum SupportTicketPriorityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum SupportProviderDto {
  INTERCOM = 'INTERCOM',
  ZENDESK = 'ZENDESK',
}

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @IsOptional()
  @IsEnum(SupportTicketPriorityDto)
  priority?: SupportTicketPriorityDto;

  @IsOptional()
  @IsEnum(SupportProviderDto)
  provider?: SupportProviderDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  transactionHash?: string;
}

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsEnum(SupportTicketPriorityDto)
  priority?: SupportTicketPriorityDto;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CreateSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;

  @IsOptional()
  @IsArray()
  attachments?: Array<{ url: string; name: string; type: string }>;
}
