import type { NotificationType } from '../../constants';
import { User, type UserDocument } from '../../models';
import { badRequest, notFound } from '../../lib/errors';
import { createSession } from '../auth/auth.service';
import type { Category } from '../../constants';

export interface ProfileChanges {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  interests?: Category[];
  preferences?: { emailNotifications?: boolean; mutedEmailTypes?: NotificationType[] };
}

export async function updateProfile(user: UserDocument, changes: ProfileChanges) {
  const { preferences, ...rest } = changes;
  user.set(rest);
  if (preferences) {
    for (const [key, value] of Object.entries(preferences)) user.set(`preferences.${key}`, value);
  }
  await user.save();
  return user;
}

/** Changing the password signs out every other session; a fresh token is returned. */
export async function changePassword(
  user: UserDocument,
  { currentPassword, newPassword }: { currentPassword: string; newPassword: string }
) {
  const account = await User.findById(user.id).select('+passwordHash');
  if (!account) throw notFound('Account not found');
  if (!(await account.checkPassword(currentPassword))) {
    throw badRequest('Your current password is incorrect', 'INVALID_PASSWORD');
  }
  await account.setPassword(newPassword);
  account.passwordChangedAt = new Date();
  await account.save();
  return createSession(account);
}
