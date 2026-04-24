import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { ProjectService } from './project.service';
import { TaggerService } from './tagger.service';
import { Project } from './dto/project.dto';
import { ProjectList } from './dto/project-list.dto';
import { ProjectFilterInput } from './dto/project-filter.dto';

@Resolver(() => Project)
export class ProjectResolver {
  constructor(
    private readonly projectService: ProjectService,
    private readonly taggerService: TaggerService,
  ) {}

  @Query(() => Project, { name: 'project' })
  async getProject(@Args('id') id: string): Promise<Project> {
    return this.projectService.findById(id);
  }

  @Query(() => Project, { name: 'projectByContractId' })
  async getProjectByContractId(@Args('contractId') contractId: string): Promise<Project> {
    return this.projectService.findByContractId(contractId);
  }

  @Throttle({ aggregate: { ttl: 60_000, limit: 10 } })
  @Query(() => ProjectList, { name: 'projects' })
  async getProjects(
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('status', { type: () => String, nullable: true }) status?: string,
    @Args('category', { type: () => String, nullable: true }) category?: string,
    @Args('filter', { type: () => ProjectFilterInput, nullable: true }) filter?: ProjectFilterInput,
  ): Promise<ProjectList> {
    return this.projectService.findAll({ skip, take, status, category, filter });
  }

  @Query(() => [Project], { name: 'activeProjects' })
  async getActiveProjects(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<Project[]> {
    return this.projectService.findActiveProjects(limit);
  }

  @Query(() => [Project], { name: 'projectsByCreator' })
  async getProjectsByCreator(
    @Args('creatorId') creatorId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<Project[]> {
    return this.projectService.findByCreator(creatorId, limit);
  }

  @Query(() => [String], { name: 'suggestProjectTags' })
  suggestProjectTags(
    @Args('title') title: string,
    @Args('description') description: string,
  ): string[] {
    return this.taggerService.suggestTags(title, description);
  }
}
