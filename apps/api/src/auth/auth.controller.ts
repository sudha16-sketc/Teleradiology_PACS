import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
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
  ForgotPasswordDto,
  ResetPasswordDto,
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
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.login(dto, request, response);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.forgotPassword(dto.email, request, response);
  }

  @Public()
  @Post('reset-password')
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.resetPassword(dto, request, response);
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

  // Rotates the Redis session and refreshes the same httpOnly cookie. No
  // credentials are re-sent and no second login authority is introduced.
  @Post('refresh')
  refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.authService.refresh(request, response);
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