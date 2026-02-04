import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
  leadId: {
    type: String,
    unique: true,
    required: false // Generated in pre-save hook
  },
  // Parent Details
  parentName: {
    type: String,
    required: true,
    trim: true
  },
  parentMobile: {
    type: String,
    required: true,
    trim: true
  },
  parentEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  parentCity: {
    type: String,
    required: true,
    trim: true
  },
  preferredLanguage: {
    type: String,
    required: true,
    trim: true
  },
  // Student Details
  studentName: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: true
  },
  currentClass: {
    type: String,
    required: true,
    trim: true
  },
  boardUniversity: {
    type: String,
    trim: true
  },
  marksPercentage: {
    type: Number,
    min: 0,
    max: 100
  },
  // Admission Preferences
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Institution',
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  academicYear: {
    type: String,
    required: true,
    trim: true
  },
  preferredCounselingMode: {
    type: String,
    enum: ['Online', 'Offline'],
    required: true
  },
  // Other
  notes: {
    type: String,
    trim: true
  },
  consent: {
    type: Boolean,
    required: true,
    default: false
  },
  // Assignment & Classification
  classification: {
    type: String,
    enum: ['RAW', 'VERIFIED', 'PRIORITY'],
    default: 'RAW'
  },
  priority: {
    type: String,
    enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    default: 'NORMAL'
  },
  assignedCounselor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CounselorProfile',
    default: null,
    required: false
  },
  autoAssigned: {
    type: Boolean,
    required: [true, 'Auto-assigned flag is required'],
    default: false
  },
  assignmentReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Assignment reason cannot exceed 500 characters'],
    default: ''
  },
  status: {
    type: String,
    enum: ['NEW', 'CONTACTED', 'FOLLOW_UP', 'ENROLLED', 'REJECTED', 'ON_HOLD'],
    default: 'NEW'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false, // We're handling timestamps manually
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
// Note: leadId already has unique: true, which creates an index automatically
leadSchema.index({ assignedCounselor: 1 });
leadSchema.index({ autoAssigned: 1 });
leadSchema.index({ classification: 1 });
leadSchema.index({ priority: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ submittedAt: -1 });
leadSchema.index({ parentEmail: 1 });
leadSchema.index({ parentMobile: 1 });
leadSchema.index({ institution: 1 });
leadSchema.index({ course: 1 });

// Compound indexes for common queries
leadSchema.index({ assignedCounselor: 1, status: 1 });
leadSchema.index({ classification: 1, priority: 1 });
leadSchema.index({ autoAssigned: 1, assignedCounselor: 1 });

// Update timestamp before saving
leadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate unique Lead ID before saving
leadSchema.pre('save', async function(next) {
  if (!this.leadId) {
    try {
      const count = await mongoose.model('Lead').countDocuments();
      const year = new Date().getFullYear();
      this.leadId = `LEAD-${year}-${String(count + 1).padStart(6, '0')}`;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Validate assignment consistency
leadSchema.pre('save', function(next) {
  // If assignedCounselor is set, ensure assignmentReason is provided
  if (this.assignedCounselor && !this.assignmentReason) {
    this.assignmentReason = this.autoAssigned 
      ? 'Auto-assigned by system' 
      : 'Manually assigned';
  }
  
  // If assignedCounselor is null, reset assignment flags
  if (!this.assignedCounselor) {
    this.autoAssigned = false;
    if (!this.assignmentReason) {
      this.assignmentReason = 'Unassigned';
    }
  }
  
  next();
});

// Instance method to check if lead is assigned
leadSchema.methods.isAssigned = function() {
  return this.assignedCounselor !== null && this.assignedCounselor !== undefined;
};

// Instance method to check if assignment is automatic
leadSchema.methods.isAutoAssigned = function() {
  return this.autoAssigned === true && this.isAssigned();
};

// Instance method to check if assignment is manual
leadSchema.methods.isManuallyAssigned = function() {
  return this.isAssigned() && !this.autoAssigned;
};

// Instance method to assign to counselor
leadSchema.methods.assignToCounselor = async function(counselorId, isAuto = false, reason = '') {
  this.assignedCounselor = counselorId;
  this.autoAssigned = isAuto;
  this.assignmentReason = reason || (isAuto ? 'Auto-assigned by system' : 'Manually assigned');
  return await this.save();
};

// Instance method to unassign from counselor
leadSchema.methods.unassign = async function(reason = 'Unassigned') {
  this.assignedCounselor = null;
  this.autoAssigned = false;
  this.assignmentReason = reason;
  return await this.save();
};

// Static method to find unassigned leads
leadSchema.statics.findUnassigned = function() {
  return this.find({ assignedCounselor: null });
};

// Static method to find auto-assigned leads
leadSchema.statics.findAutoAssigned = function() {
  return this.find({ autoAssigned: true, assignedCounselor: { $ne: null } });
};

// Static method to find manually assigned leads
leadSchema.statics.findManuallyAssigned = function() {
  return this.find({ autoAssigned: false, assignedCounselor: { $ne: null } });
};

// Static method to find leads by counselor
leadSchema.statics.findByCounselor = function(counselorId) {
  return this.find({ assignedCounselor: counselorId });
};

// Static method to find leads by classification
leadSchema.statics.findByClassification = function(classification) {
  return this.find({ classification });
};

// Static method to find leads by priority
leadSchema.statics.findByPriority = function(priority) {
  return this.find({ priority });
};

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
