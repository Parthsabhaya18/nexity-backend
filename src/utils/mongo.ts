import mongoose from 'mongoose';

/** MongoDB duplicate-key error. One definition so every write handles races the same way. */
export const MONGO_DUPLICATE_KEY = 11000;

export function isDuplicateKey(err: unknown): err is mongoose.mongo.MongoServerError {
  return err instanceof mongoose.mongo.MongoServerError && err.code === MONGO_DUPLICATE_KEY;
}
