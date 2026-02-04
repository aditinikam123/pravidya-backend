import mongoose from 'mongoose';

const counselingSessionSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  counselor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CounselorProfile',
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  mode: {
    type: String,
    enum: ['Online', 'Offline'],
    required: true
  },
  status: {
    type: String,
    enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'],
    default: 'SCHEDULED'
  },
  remarks: {
    type: String,
    trim: true
  },
  followUpRequired: {
    type: Boolean,
    default: false
  },
  followUpDate: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

counselingSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const CounselingSession = mongoose.model('CounselingSession', counselingSessionSchema);

export default CounselingSession;
