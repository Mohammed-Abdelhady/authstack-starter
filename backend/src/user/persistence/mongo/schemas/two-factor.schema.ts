import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * A TOTP secret encrypted with AES-256-GCM. The three parts are base64.
 * Nothing here is usable without TOTP_ENCRYPTION_KEY.
 */
@Schema({ _id: false })
export class TwoFactorSecret {
  @Prop({ required: true })
  ciphertext!: string;

  @Prop({ required: true })
  iv!: string;

  @Prop({ required: true })
  tag!: string;
}

export const TwoFactorSecretSchema =
  SchemaFactory.createForClass(TwoFactorSecret);

/** One recovery code. Only its sha256 is stored, and it works once. */
@Schema({ _id: false })
export class RecoveryCode {
  /** sha256 of the code, hex encoded. */
  @Prop({ required: true })
  hash!: string;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const RecoveryCodeSchema = SchemaFactory.createForClass(RecoveryCode);

/**
 * Second factor state on a user. A secret is written by setup and stays
 * unconfirmed until a first correct code arrives, so a failed setup leaves the
 * account signing in the way it did before.
 */
@Schema({ _id: false })
export class TwoFactor {
  @Prop({ default: false })
  enabled!: boolean;

  @Prop({ type: TwoFactorSecretSchema, default: null })
  secret!: TwoFactorSecret | null;

  /** Set by the confirm step. Null while a secret is still pending. */
  @Prop({ type: Date, default: null })
  confirmedAt!: Date | null;

  @Prop({ type: [RecoveryCodeSchema], default: [] })
  recoveryCodes!: RecoveryCode[];

  /**
   * Highest TOTP step already spent. A code is good for 30 seconds, so without
   * this an observer who reads one off the screen can use it again.
   */
  @Prop({ type: Number, default: null })
  lastUsedStep!: number | null;

  /**
   * Wrong answers since the last correct one. Every fifth locks the factor,
   * for longer each time, so guesses are bounded per account and not only
   * per sign-in attempt or per client address.
   */
  @Prop({ type: Number, default: 0 })
  failedAttempts!: number;

  /** No answer is checked before this instant. */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;
}

export const TwoFactorSchema = SchemaFactory.createForClass(TwoFactor);
