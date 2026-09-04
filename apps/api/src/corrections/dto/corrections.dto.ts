import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCorrectionRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason for the correction is required' })
  @MaxLength(2000)
  reason!: string;
}

export class RejectCorrectionDto {
  @IsString()
  @IsNotEmpty({ message: 'A resolution is required to reject a correction request' })
  @MaxLength(2000)
  resolution!: string;
}
