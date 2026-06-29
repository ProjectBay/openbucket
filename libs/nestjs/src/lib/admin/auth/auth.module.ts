import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

import { PersistenceModule } from '../../persistence.module';
import { AuditService } from '../audit/audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Admin authentication module (WHITEPAPER §5.2.1). Registers Passport + a
 * JwtModule signing 15-minute access tokens (issuer `openbucket`, audience
 * `openbucket-admin`) keyed on `JWT_SECRET`, plus a named `login` throttler at
 * 5/min that the login endpoint applies. Exports AuthService + JwtModule so the
 * global JwtAuthGuard (STORY-0407) can verify tokens.
 */
@Module({
  imports: [
    PassportModule,
    PersistenceModule,
    // The `login` throttler (5/min) is registered in AdminModule's single global
    // ThrottlerModule.forRoot — ThrottlerModule is @Global, so a second forRoot
    // here would deadlock DI at boot. The login endpoint applies it by name.
    JwtModule.registerAsync({
      // ConfigService is provided globally by the (dual-mode) ConfigModule.
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          issuer: 'openbucket',
          audience: 'openbucket-admin',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshTokenService, AuditService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
