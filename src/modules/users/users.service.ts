import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ChangePasswordDto } from './dto/update-user.dto';
import { Role } from '../../common/enums/role.enum';
import * as bcrypt from 'bcrypt';

// Tipo seguro — nunca exponer campos sensibles en respuestas de API
export type SafeUser = Omit<User, 'passwordHash' | 'totpSecret' | 'backupCodes' | 'failedLoginAttempts' | 'lockedUntil'>;

const MAX_FAILED_ATTEMPTS    = 5;
const LOCKOUT_MINUTES        = 15;
const DUMMY_HASH = '$2b$12$invalidhashtopreventtimingattacks.padding00000000000';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // Creación
  // ────────────────────────────────────────────────────────────────

  async create(dto: CreateUserDto): Promise<SafeUser> {
    await this.assertUsernameAvailable(dto.username);
    if (dto.email) await this.assertEmailAvailable(dto.email);

    const rounds      = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        username:     dto.username.toLowerCase().trim(),
        email:        dto.email?.toLowerCase().trim() ?? null,
        passwordHash,
        fullName:     dto.fullName ?? null,
        roles:        dto.roles    ?? [Role.USER],
        isAdmin:      dto.isAdmin  ?? false,
      },
    });

    this.logger.log(`Usuario creado: ${user.username} [${user.id}]`);
    return this.toSafe(user);
  }

  // ────────────────────────────────────────────────────────────────
  // Consultas
  // ────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return this.toSafe(user);
  }

  /** Solo para uso interno (autenticación) — devuelve passwordHash */
  async findByUsernameForAuth(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username: username.toLowerCase().trim() },
    });
  }

  async findAll(params: {
    page?:     number;
    limit?:    number;
    search?:   string;
    isActive?: boolean;
    role?:     string;
  }): Promise<{ data: SafeUser[]; meta: any }> {
    const page  = params.page  ?? 1;
    const limit = params.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.role)    where.roles = { has: params.role };
    if (params.search) {
      where.OR = [
        { username: { contains: params.search, mode: 'insensitive' } },
        { fullName: { contains: params.search, mode: 'insensitive' } },
        { email:    { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map(this.toSafe),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Actualización
  // ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    await this.assertExists(id);

    if (dto.email) await this.assertEmailAvailable(dto.email, id);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email:    dto.email    ?? undefined,
        fullName: dto.fullName ?? undefined,
        roles:    dto.roles    ?? undefined,
        isActive: dto.isActive ?? undefined,
        isAdmin:  dto.isAdmin  ?? undefined,
        avatarUrl: dto.avatarUrl ?? undefined,
      },
    });

    this.logger.log(`Usuario actualizado: ${user.username} [${id}]`);
    return this.toSafe(user);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    isAdmin = false,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Si no es admin, verificar contraseña actual
    if (!isAdmin) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Se requiere la contraseña actual');
      }
      const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new BadRequestException('Contraseña actual incorrecta');
      }
    }

    const rounds      = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const newHash     = await bcrypt.hash(dto.newPassword, rounds);

    await this.prisma.user.update({
      where: { id: userId },
      data:  { passwordHash: newHash },
    });

    this.logger.log(`Contraseña cambiada para usuario [${userId}]`);
  }

  // ────────────────────────────────────────────────────────────────
  // Validación de credenciales — para la LocalStrategy
  // ────────────────────────────────────────────────────────────────

  async validateCredentials(username: string, password: string): Promise<SafeUser | null> {
    const user = await this.findByUsernameForAuth(username);

    // Usuario inexistente o inactivo — bcrypt dummy para evitar timing attack
    if (!user || !user.isActive) {
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }

    // Cuenta bloqueada
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Cuenta bloqueada por múltiples intentos fallidos. Reintenta en ${remaining} minuto(s).`,
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          ...(shouldLock && {
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          }),
        },
      });

      this.logger.warn(
        `Intento fallido #${attempts} para usuario '${username}'` +
        (shouldLock ? ` — cuenta bloqueada ${LOCKOUT_MINUTES} min` : ''),
      );

      return null;
    }

    // Login exitoso — resetear contador
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data:  { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return this.toSafe(user);
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────

  private toSafe(user: User): SafeUser {
    const { passwordHash, totpSecret, backupCodes, ...safe } = user;
    return safe;
  }

  private async assertExists(id: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Usuario no encontrado');
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where:  { username: username.toLowerCase().trim() },
      select: { id: true },
    });
    if (existing) throw new ConflictException('El username ya está en uso');
  }

  private async assertEmailAvailable(email: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where:  { email: email.toLowerCase().trim() },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('El email ya está en uso');
    }
  }
}
