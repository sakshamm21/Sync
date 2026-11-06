import { Schema, model, type HydratedDocument, type Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env';
import {
  ROLES,
  USER_STATUS,
  CATEGORY_VALUES,
  NOTIFICATION_TYPES,
  type Category,
  type NotificationType,
  type Role,
  type UserStatus,
} from '../constants';

// Hashing is deliberately slow; tests use the minimum cost to stay fast.
const BCRYPT_ROUNDS = env.isTest ? 4 : 12;

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  emailVerification?: { codeHash?: string; expiresAt?: Date; attempts: number; sentAt?: Date };
  passwordReset?: { tokenHash?: string; expiresAt?: Date; sentAt?: Date };
  /** Tokens issued before this are refused ("sign out of all devices"). */
  sessionsRevokedAt?: Date;
  /** Secret in the user's calendar subscription URL. */
  calendarToken?: string;
  // Tokens issued before this instant are rejected (password change / reset).
  passwordChangedAt?: Date;
  bio: string;
  avatarUrl: string;
  organization: string;
  interests: Category[];
  /** `mutedEmailTypes`: notification types that stay in the app and are never emailed. */
  preferences: { emailNotifications: boolean; mutedEmailTypes: NotificationType[]; autoAcceptWaitlist: boolean };
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal public shape used when embedding a user in other resources. */
export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string;
  organization: string;
  role: Role;
}

interface UserMethods {
  setPassword(plain: string): Promise<void>;
  checkPassword(plain: string): Promise<boolean>;
  /** `issuedAt` is a JWT `iat` (seconds since epoch). */
  tokenIssuedBeforePasswordChange(issuedAt: number): boolean;
  toSummary(): UserSummary;
}

type UserModel = Model<IUser, {}, UserMethods>;
export type UserDocument = HydratedDocument<IUser, UserMethods>;

const userSchema = new Schema<IUser, UserModel, UserMethods>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.MEMBER, index: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },

    emailVerified: { type: Boolean, default: false },
    emailVerification: {
      type: { codeHash: String, expiresAt: Date, attempts: { type: Number, default: 0 }, sentAt: Date },
      select: false,
    },
    passwordReset: {
      type: { tokenHash: String, expiresAt: Date, sentAt: Date },
      select: false,
    },
    passwordChangedAt: { type: Date, select: false },
    sessionsRevokedAt: { type: Date, select: false },
    calendarToken: { type: String, select: false, index: { unique: true, sparse: true } },

    bio: { type: String, trim: true, maxlength: 500, default: '' },
    avatarUrl: { type: String, trim: true, default: '' },
    organization: { type: String, trim: true, maxlength: 120, default: '' },
    interests: [{ type: String, enum: CATEGORY_VALUES }],
    preferences: {
      emailNotifications: { type: Boolean, default: true },
      mutedEmailTypes: { type: [{ type: String, enum: Object.values(NOTIFICATION_TYPES) }], default: [] },
      // "Take any seat automatically": skip the claim step on events that use one.
      autoAcceptWaitlist: { type: Boolean, default: false },
    },
    lastLoginAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        delete ret.emailVerification;
        delete ret.passwordReset;
        delete ret.sessionsRevokedAt;
        delete ret.calendarToken;
        delete ret.passwordChangedAt;
        return ret;
      },
    },
  }
);

userSchema.method('setPassword', async function setPassword(plain: string) {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
});

userSchema.method('checkPassword', function checkPassword(plain: string) {
  return bcrypt.compare(plain, this.passwordHash);
});

/** True if a token issued at `issuedAt` predates a password change or a "sign out everywhere". */
userSchema.method('tokenIssuedBeforePasswordChange', function tokenIssuedBeforePasswordChange(issuedAt: number) {
  const cutoffs = [this.passwordChangedAt, this.sessionsRevokedAt].filter((d): d is Date => Boolean(d));
  return cutoffs.some((d) => issuedAt < Math.floor(d.getTime() / 1000));
});

/** A real hash of nothing, so checking a password for an unknown email takes as long as for a real one. */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

userSchema.method('toSummary', function toSummary(): UserSummary {
  return { id: this.id, name: this.name, avatarUrl: this.avatarUrl, organization: this.organization, role: this.role };
});

export const User = model<IUser, UserModel>('User', userSchema);
