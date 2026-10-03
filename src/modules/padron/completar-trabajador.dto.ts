import { PickType } from '@nestjs/swagger';
import { UpdateTrabajadorDto } from '../admin/dto/update-trabajador.dto';

/**
 * Datos con los que un servicio puede COMPLETAR una ficha: solo se escriben en
 * los campos que el IAM tiene vacíos. Sirve también para fichas con cuenta
 * (rellenar un vacío no cambia la identidad que gestiona el portal).
 */
export class CompletarTrabajadorDto extends PickType(UpdateTrabajadorDto, [
  'jde', 'disciplina', 'celular', 'areaCodigo',
] as const) {}
