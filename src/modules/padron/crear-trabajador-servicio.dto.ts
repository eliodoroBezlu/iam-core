import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateTrabajadorDto } from '../admin/dto/create-trabajador.dto';

/** Alta desde un servicio; con `userId`, la ficha nace vinculada a esa cuenta. */
export class CrearTrabajadorServicioDto extends CreateTrabajadorDto {
  // Para la cuenta que entra al servicio sin tener ficha: así la ficha no
  // queda suelta (un servicio no puede vincularlas después).
  @ApiPropertyOptional({ description: 'Cuenta del IAM a la que se vincula la ficha' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
