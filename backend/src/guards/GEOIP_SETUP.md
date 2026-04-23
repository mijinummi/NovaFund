# GeoIP Guard Setup Guide

## Overview
The GeoIP Guard provides regional investment restrictions based on user IP addresses using MaxMind GeoIP2 database.

## Setup Instructions

### 1. Install MaxMind GeoIP2 Package
```bash
cd backend
npm install @maxmind/geoip2-node
```

### 2. Download GeoLite2 Database
1. Create a free account at https://dev.maxmind.com/geoip/geolite2-free-geolocation-data
2. Download the GeoLite2 Country database (`.mmdb` format)
3. Place it in your backend data directory:
   ```
   backend/data/GeoLite2-Country.mmdb
   ```

### 3. Configure Environment Variables
Add to your `.env` file:
```env
GEOLITE2_DB_PATH=./data/GeoLite2-Country.mmdb
```

### 4. Register the Guard in Your Module
```typescript
import { Module } from '@nestjs/common';
import { GeoGuard } from '../guards/geo.guard';
import { DatabaseModule } from '../database.module';

@Module({
  imports: [DatabaseModule],
  providers: [GeoGuard],
  exports: [GeoGuard],
})
export class YourModule {}
```

### 5. Use the Guard in Controllers
```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { GeoGuard } from '../guards/geo.guard';

@Controller('investments')
export class InvestmentController {
  @Post('intent')
  @UseGuards(GeoGuard)
  async createInvestmentIntent(@Body() data: CreateInvestmentDto) {
    // Your investment logic here
    // The guard will automatically check geo-restrictions
  }
}
```

### 6. Set Restricted Regions for Projects
When creating or updating a project, specify restricted country codes:
```typescript
await prisma.project.create({
  data: {
    title: 'My Project',
    // ... other fields
    restrictedRegions: ['US', 'CN', 'RU'], // ISO 3166-1 alpha-2 country codes
  },
});
```

## How It Works

1. **IP Detection**: The guard extracts the client IP from:
   - `X-Forwarded-For` header (for proxied requests)
   - `X-Real-IP` header
   - Direct connection IP

2. **Country Lookup**: Uses MaxMind GeoIP2 to determine the user's country

3. **Restriction Check**: Compares the country against the project's `restrictedRegions` array

4. **Access Control**: 
   - If country is restricted → Returns 403 Forbidden with clear error message
   - If country is allowed → Allows the request to proceed
   - If GeoIP database is unavailable → Gracefully allows (logs warning)

## ISO Country Codes
Use ISO 3166-1 alpha-2 codes for restricted regions:
- US: United States
- CN: China
- RU: Russia
- GB: United Kingdom
- DE: Germany
- FR: France
- JP: Japan
- etc.

## Error Response
When a user from a restricted region tries to invest:
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Investments from US are not allowed for this project due to regulatory restrictions.",
  "country": "US"
}
```

## Graceful Degradation
The guard is designed to fail gracefully:
- If MaxMind package is not installed → Skips geo check, logs warning
- If database file is missing → Skips geo check, logs warning
- If IP lookup fails → Allows request, logs warning

This ensures your application continues to work even if the GeoIP service is temporarily unavailable.

## Testing
You can test the guard by:
1. Setting up a project with restricted regions
2. Using a VPN or proxy to simulate different countries
3. Attempting to create an investment intent
4. Verifying the 403 response for restricted countries

## Performance Considerations
- GeoIP2 database is loaded into memory on initialization
- Country lookups are fast (< 1ms)
- No external API calls required
- Database should be updated monthly for accuracy

## Regulatory Compliance
This feature helps you comply with:
- SEC regulations (US securities laws)
- EU investment directives
- Country-specific crowdfunding regulations
- Sanctions and embargoes

Always consult with legal counsel to determine which regions to restrict for your specific use case.
