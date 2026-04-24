import { Resolver, Query, Args, Int, Info } from '@nestjs/graphql';
import { GraphQLResolveInfo } from 'graphql';
import { parseResolveInfo, ResolveTree } from 'graphql-parse-resolve-info';
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

  /**
   * Extract required fields from GraphQL resolve info for database optimization
   */
  private getRequiredFields(info: GraphQLResolveInfo): string[] {
    const parsedResolveInfo = parseResolveInfo(info) as ResolveTree;
    const fields: string[] = [];

    if (parsedResolveInfo) {
      // Always include id as it's typically required
      fields.push('id');

      // Check for basic project fields
      const projectFields = [
        'contractId', 'creatorId', 'title', 'description', 'category',
        'goal', 'currentFunds', 'deadline', 'ipfsHash', 'status',
        'createdAt', 'updatedAt'
      ];

      projectFields.forEach(field => {
        if (parsedResolveInfo.fields[field]) {
          fields.push(field);
        }
      });

      // Check for _count field (relations count)
      if (parsedResolveInfo.fields._count) {
        fields.push('_count');
      }
    }

    return fields;
  }

  @Query(() => Project, { name: 'project' })
  async getProject(
    @Args('id') id: string,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Project> {
    const requiredFields = this.getRequiredFields(info);
    return this.projectService.findById(id, requiredFields);
  }

  @Query(() => Project, { name: 'projectByContractId' })
  async getProjectByContractId(
    @Args('contractId') contractId: string,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Project> {
    const requiredFields = this.getRequiredFields(info);
    return this.projectService.findByContractId(contractId, requiredFields);
  }

  @Throttle({ aggregate: { ttl: 60_000, limit: 10 } })
  @Query(() => ProjectList, { name: 'projects' })
  async getProjects(
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('status', { type: () => String, nullable: true }) status?: string,
    @Args('category', { type: () => String, nullable: true }) category?: string,
    @Args('filter', { type: () => ProjectFilterInput, nullable: true }) filter?: ProjectFilterInput,
    @Info() info: GraphQLResolveInfo,
  ): Promise<ProjectList> {
    const requiredFields = this.getRequiredFields(info);
    return this.projectService.findAll({ skip, take, status, category, filter }, requiredFields);
  }

  @Query(() => [Project], { name: 'activeProjects' })
  async getActiveProjects(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Project[]> {
    const requiredFields = this.getRequiredFields(info);
    return this.projectService.findActiveProjects(limit, requiredFields);
  }

  @Query(() => [Project], { name: 'projectsByCreator' })
  async getProjectsByCreator(
    @Args('creatorId') creatorId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Info() info: GraphQLResolveInfo,
  ): Promise<Project[]> {
    const requiredFields = this.getRequiredFields(info);
    return this.projectService.findByCreator(creatorId, limit, requiredFields);
  }

  @Query(() => [String], { name: 'suggestProjectTags' })
  suggestProjectTags(
    @Args('title') title: string,
    @Args('description') description: string,
  ): string[] {
    return this.taggerService.suggestTags(title, description);
  }
}
