import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service.js';
import {
  Public,
  Roles,
  CurrentUser,
} from './auth.decorators.js';
import type { AuthenticatedUser } from './auth.constants.js';
import {
  RegisterDto,
  LoginDto,
  ApproveRequestDto,
  RejectRequestDto,
} from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(dto, response);
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    return this.authService.logout(response);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  @Roles(UserRole.ADMIN)
  @Get('registration-requests')
  registrationRequests(@Query('status') status?: string) {
    return this.authService.listRegistrationRequests(status);
  }

  @Roles(UserRole.ADMIN)
  @Post('registration-requests/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.authService.approveRegistrationRequest(id, dto, admin);
  }

  @Roles(UserRole.ADMIN)
  @Post('registration-requests/:id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.authService.rejectRegistrationRequest(id, dto, admin);
  }
}