import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
  ) {
    const key = this.config.get<string>('TOTP_ENCRYPTION_KEY');
    if (!key || key.length < 32) {
      throw new Error('TOTP_ENCRYPTION_KEY debe tener al menos 32 caracteres');
    }
    // Derivar clave de 32 bytes desde la env var
    this.encryptionKey = createHash('sha256').update(key).digest();
  }

  // ────────────────────────────────────────────────────────────────
  // Setup — Genera secret y QR
  // ────────────────────────────────────────────────────────────────

  async initiateSetup(userId: string): Promise<{ secret: string; qrCodeUrl: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, username: true, email: true, totpEnabled: true },
    });

    if (!user) throw new BadRequestException('Usuario no encontrado');
    if (user.totpEnabled) throw new ConflictException('2FA ya está habilitado. Desactívalo primero.');

    const appName = this.config.get<string>('APP_NAME', 'IAM Core');
    const label   = user.email ?? user.username;

    const secret = speakeasy.generateSecret({
      name:   `${appName} (${label})`,
      length: 32,
    });

    // Cifrar el secret antes de guardarlo temporalmente
    const encryptedSecret = this.encrypt(secret.base32);

    // Guardar secret (aún no activado — totpEnabled sigue false)
    await this.prisma.user.update({
      where: { id: userId },
      data:  { totpSecret: encryptedSecret },
    });

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

    return {
      secret:     secret.base32,           // Solo para mostrar al usuario una vez
      qrCodeUrl,
      otpauthUrl: secret.otpauth_url!,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // Enable — Confirma con primer código válido
  // ────────────────────────────────────────────────────────────────

  async enable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, totpSecret: true, totpEnabled: true },
    });

    if (!user)             throw new BadRequestException('Usuario no encontrado');
    if (!user.totpSecret)  throw new BadRequestException('Primero inicia el setup de 2FA');
    if (user.totpEnabled)  throw new ConflictException('2FA ya está habilitado');

    const secret  = this.decrypt(user.totpSecret);
    const isValid = this.verifyCode(secret, code);

    if (!isValid) {
      throw new BadRequestException('Código 2FA inválido. Verifica la hora de tu dispositivo.');
    }

    // Generar 10 códigos de recuperación
    const { plainCodes, hashedCodes } = await this.generateBackupCodes(10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled:  true,
        backupCodes:  hashedCodes,
      },
    });

    return { backupCodes: plainCodes }; // Solo se devuelven una vez
  }

  // ────────────────────────────────────────────────────────────────
  // Disable — Desactiva 2FA con código activo
  // ────────────────────────────────────────────────────────────────

  async disable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, totpSecret: true, totpEnabled: true },
    });

    if (!user)            throw new BadRequestException('Usuario no encontrado');
    if (!user.totpEnabled) throw new BadRequestException('2FA no está habilitado');

    const secret  = this.decrypt(user.totpSecret!);
    const isValid = this.verifyCode(secret, code);

    if (!isValid) {
      throw new BadRequestException('Código 2FA inválido');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled:  false,
        totpSecret:   null,
        backupCodes:  [],
      },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Verify — Valida código durante login
  // ────────────────────────────────────────────────────────────────

  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { totpSecret: true, totpEnabled: true, backupCodes: true },
    });

    if (!user || !user.totpEnabled || !user.totpSecret) return false;

    const secret  = this.decrypt(user.totpSecret);
    const isValid = this.verifyCode(secret, code);

    if (isValid) return true;

    // Intentar código de recuperación
    return this.verifyBackupCode(userId, code, user.backupCodes);
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers privados
  // ────────────────────────────────────────────────────────────────

  verifyCode(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window:   1, // tolerancia ±30 segundos
    });
  }

  private async verifyBackupCode(
    userId: string,
    code: string,
    hashedCodes: string[],
  ): Promise<boolean> {
    for (let i = 0; i < hashedCodes.length; i++) {
      const isValid = await bcrypt.compare(code.toUpperCase(), hashedCodes[i]);
      if (isValid) {
        // Eliminar el código de recuperación usado (one-time)
        const updatedCodes = hashedCodes.filter((_, idx) => idx !== i);
        await this.prisma.user.update({
          where: { id: userId },
          data:  { backupCodes: updatedCodes },
        });
        return true;
      }
    }
    return false;
  }

  private async generateBackupCodes(count: number) {
    const bcryptRounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const plainCodes   = Array.from({ length: count }, () =>
      randomBytes(4).toString('hex').toUpperCase(), // Ej: "3F4A8B2C"
    );
    const hashedCodes  = await Promise.all(
      plainCodes.map((code) => bcrypt.hash(code, bcryptRounds)),
    );
    return { plainCodes, hashedCodes };
  }

  // ────────────────────────────────────────────────────────────────
  // Cifrado AES-256-CBC del TOTP secret en BD
  // ────────────────────────────────────────────────────────────────

  private encrypt(text: string): string {
    const iv         = randomBytes(16);
    const cipher     = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    if (!ivHex || !encryptedHex) {
      throw new BadRequestException('Formato de secret cifrado inválido');
    }
    const iv        = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher  = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
