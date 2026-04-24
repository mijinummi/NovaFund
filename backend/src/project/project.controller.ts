import { Controller, Get, Param, Query, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { Scopes } from '../decorators/scopes.decorator';
import { ProjectService } from './project.service';
import { Project } from './dto/project.dto';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get(':id')
  async getProject(@Param('id') id: string): Promise<Project> {
    return this.projectService.findById(id);
  }

  @Get('contract/:contractId')
  async getProjectByContractId(@Param('contractId') contractId: string): Promise<Project> {
    return this.projectService.findByContractId(contractId);
  }

  @Get()
  async getProjects(
    @Query('skip') skip?: number,
    @Query('take') take?: number,
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    return this.projectService.findAll({ 
      skip: skip ? parseInt(skip.toString()) : undefined,
      take: take ? parseInt(take.toString()) : undefined,
      status,
      category,
    });
  }

  @Get('active/list')
  async getActiveProjects(@Query('limit') limit?: number) {
    return this.projectService.findActiveProjects(limit ? parseInt(limit.toString()) : undefined);
  }

  @Get('creator/:creatorId')
  async getProjectsByCreator(
    @Param('creatorId') creatorId: string,
    @Query('limit') limit?: number,
  ) {
    return this.projectService.findByCreator(creatorId, limit ? parseInt(limit.toString()) : undefined);
  }

  @Patch(':id')
  @UseGuards(ApiKeyGuard)
  @Scopes('project:edit')
  async updateProject(@Param('id') id: string, @Body() data: any) {
    // In a real implementation, this would call projectService.update
    return { success: true, id, message: 'Project updated successfully (scope validated)' };
  }
}
