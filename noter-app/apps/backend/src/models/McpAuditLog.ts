import mongoose, { Document, Schema } from 'mongoose';

export interface IMcpAuditLog extends Document {
  userId: string;
  createdAt: Date;
  payloadEnc: string;
}

const McpAuditLogSchema: Schema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    payloadEnc: { type: String, required: true },
  },
  {
    timestamps: false,
  }
);

McpAuditLogSchema.index({ userId: 1, createdAt: -1 });
McpAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 });

export default mongoose.models.McpAuditLog || mongoose.model<IMcpAuditLog>('McpAuditLog', McpAuditLogSchema);
