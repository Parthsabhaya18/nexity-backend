import mongoose from 'mongoose';

import { ApiError } from '../../utils/ApiError';
import type { UserDoc } from '../users/user.model';
import { REPORT_REASONS, REPORT_TARGETS, Report } from './report.model';
import { MONGO_DUPLICATE_KEY } from '../../utils/mongo';


export async function createReport(
  reporter: UserDoc,
  input: {
    target_type: (typeof REPORT_TARGETS)[number];
    target_id: string;
    reason: (typeof REPORT_REASONS)[number];
    details: string;
  },
) {
  if (input.reason === 'other' && input.details.trim().length < 10) {
    throw ApiError.badRequest(
      'Tell us a little more (at least 10 characters).',
      { field: 'details' },
      'DETAILS_REQUIRED',
    );
  }
  try {
    await Report.create({
      reporter_id: reporter._id,
      target_type: input.target_type,
      target_id: input.target_id,
      reason: input.reason,
      details: input.details.trim(),
    });
  } catch (err) {
    // A second report of the same thing stays a quiet success.
    if (!(err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY)) {
      throw err;
    }
  }
}
