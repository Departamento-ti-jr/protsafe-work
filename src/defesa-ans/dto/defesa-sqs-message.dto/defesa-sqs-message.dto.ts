import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnexoAdicionalDto } from './anexo-adicional.dto';

export class DefesaSqsMessageDto {

  // ⚠️ vem como string → converter
  @Type(() => Number)
  @IsNumber()
  id: number;

  @IsString()
  ansRegister: string;

  @Type(() => Number)
  @IsNumber()
  numeroAbi: number;

  @IsString()
  ordem: string;

  @IsString()
  s3PdfPath: string;

  @IsString()
  numeroProcesso: string;

  @IsString()
  competencia: string;

  @IsString()
  dataFinal: string;

  // ⚠️ NÃO pode ser number (estoura limite JS)
  @IsString()
  numeroAihApac: string;

  @IsIn(['IMPUGNACAO', 'RECURSO'])
  tipoDefesa: 'IMPUGNACAO' | 'RECURSO';

  @IsString()
  registroAns: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  requiredDocsCount?: number;

  @IsOptional()
  @IsString()
  dataInclusao?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnexoAdicionalDto)
  s3PathDocAdicional?: AnexoAdicionalDto[];
}