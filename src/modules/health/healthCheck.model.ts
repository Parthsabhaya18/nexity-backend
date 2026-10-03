import mongoose from 'mongoose';

const healthCheckSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 200 },
    source: { type: String, required: true, trim: true, maxlength: 50 },
  },
  { collection: 'health_checks', timestamps: { createdAt: 'created_at', updatedAt: false } },
);

export const HealthCheck = mongoose.model('HealthCheck', healthCheckSchema);
