/** Records an admin action. Never throws: a logging failure must not undo the action. */
import type { Types } from 'mongoose';
import { AuditLog, type IAuditLog } from '../models';
import logger from './logger';

export async function audit(actor: { _id: Types.ObjectId }, action: string, summary: string, target: IAuditLog['target']) {
  try {
    await AuditLog.create({ actor: actor._id, action, summary, target });
  } catch (err) {
    logger.error({ err, action }, 'Could not write the audit log');
  }
}
