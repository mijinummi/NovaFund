import { Module } from '@nestjs/common';
import { UserController } from '../user.controller';
import { AccountSecurityService } from './account-security.service';
import { DatabaseModule } from '../database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [UserController],
  providers: [AccountSecurityService],
  exports: [AccountSecurityService],
})
export class UserModule {}