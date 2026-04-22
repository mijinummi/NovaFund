import { Controller, Post, Get, Body, Param, Res, Redirect } from '@nestjs/common';
import { ShortlinkService } from '../services/shortlink.service';
import { Response } from 'express';

@Controller()
export class ShortlinkController {
  constructor(private readonly shortlinkService: ShortlinkService) {}

  @Post('api/shortlink')
  async createShortlink(@Body() body: { url: string; projectId?: string }) {
    return this.shortlinkService.createShortlink(body.url, body.projectId);
  }

  @Get('api/shortlink/trending')
  async getTrendingProjects() {
    return this.shortlinkService.getTrendingProjects(10);
  }

  // Redirect endpoint for the short code
  // Example: GET /s/xyz -> Redirects to the original URL
  @Get('s/:code')
  async redirectShortlink(@Param('code') code: string, @Res() res: Response) {
    const originalUrl = await this.shortlinkService.getAndTrack(code);
    return res.redirect(originalUrl);
  }
}
