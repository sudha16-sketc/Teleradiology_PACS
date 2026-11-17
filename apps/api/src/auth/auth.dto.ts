import { IsString, IsEmail, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { IsStrongPassword } from '../common/validators/strong-password.js';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @IsEnum(UserRole)
  requestedRole!: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  licenseNumber?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @IsStrongPassword()
  password!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class ApproveRequestDto {
  @IsEnum(UserRole)
  role!: UserRole;

  /**
   * Hospital the account belongs to. Required when the approved role is
   * HOSPITAL: an approved HOSPITAL account with no linked hospital cannot read
   * or write any study, report or correction (every hospital route is scoped by
   * user.hospitalId), so approving without one produces a permanently broken
   * login. Ignored for non-HOSPITAL roles.
   */
  @IsOptional()
  @IsString()
  hospitalId?: string;
}

export class RejectRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}