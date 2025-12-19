import { IsString } from 'class-validator';

export class AnexoAdicionalDto {
  @IsString()
  id: string;

  @IsString()
  url: string;
}