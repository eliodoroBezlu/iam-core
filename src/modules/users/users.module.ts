import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { RoleCatalogModule } from '../../common/services/role-catalog.module';

@Module({
  imports:   [RoleCatalogModule],
  providers: [UsersService],
  exports:   [UsersService],
})
export class UsersModule {}
