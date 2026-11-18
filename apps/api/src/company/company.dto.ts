import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsPhoneInput } from '../common/validators/phone.js';

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsPhoneInput()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  disclaimer?: string;
}
