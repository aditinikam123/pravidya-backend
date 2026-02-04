import mongoose from 'mongoose';

const counselorProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    unique: true
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [100, 'Full name cannot exceed 100 characters']
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    trim: true,
    match: [/^[0-9]{10}$/, 'Mobile number must be 10 digits']
  },
  expertise: [{
    type: String,
    trim: true,
    required: false
  }],
  languages: [{
    type: String,
    trim: true,
    required: false
  }],
  availability: {
    type: String,
    enum: {
      values: ['ACTIVE', 'INACTIVE'],
      message: 'Availability must be either ACTIVE or INACTIVE'
    },
    required: [true, 'Availability status is required'],
    default: 'ACTIVE'
  },
  maxCapacity: {
    type: Number,
    required: [true, 'Max capacity is required'],
    default: 50,
    min: [1, 'Max capacity must be at least 1'],
    max: [1000, 'Max capacity cannot exceed 1000']
  },
  currentLoad: {
    type: Number,
    default: 0,
    min: [0, 'Current load cannot be negative'],
    validate: {
      validator: function(value) {
        return value <= this.maxCapacity;
      },
      message: 'Current load cannot exceed max capacity'
    }
  },
  assignedLeads: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  }],
  createdAt: {
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
// Note: userId already has unique: true, which creates an index automatically
counselorProfileSchema.index({ availability: 1 });
counselorProfileSchema.index({ currentLoad: 1 });
counselorProfileSchema.index({ expertise: 1 });
counselorProfileSchema.index({ languages: 1 });

// Virtual for load percentage
counselorProfileSchema.virtual('loadPercentage').get(function() {
  if (this.maxCapacity === 0) return 0;
  return Math.round((this.currentLoad / this.maxCapacity) * 100);
});

// Virtual for available capacity
counselorProfileSchema.virtual('availableCapacity').get(function() {
  return Math.max(0, this.maxCapacity - this.currentLoad);
});

// Update timestamp before saving
counselorProfileSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Validate currentLoad doesn't exceed maxCapacity before saving
counselorProfileSchema.pre('save', function(next) {
  if (this.currentLoad > this.maxCapacity) {
    return next(new Error('Current load cannot exceed max capacity'));
  }
  next();
});

// Instance method to check if counselor is available
counselorProfileSchema.methods.isAvailable = function() {
  return this.availability === 'ACTIVE' && this.currentLoad < this.maxCapacity;
};

// Instance method to check if counselor has expertise
counselorProfileSchema.methods.hasExpertise = function(expertiseName) {
  if (!this.expertise || this.expertise.length === 0) return false;
  return this.expertise.some(exp => 
    exp.toLowerCase().includes(expertiseName.toLowerCase()) ||
    expertiseName.toLowerCase().includes(exp.toLowerCase())
  );
};

// Instance method to check if counselor speaks language
counselorProfileSchema.methods.speaksLanguage = function(language) {
  if (!this.languages || this.languages.length === 0) return false;
  return this.languages.some(lang => 
    lang.toLowerCase() === language.toLowerCase()
  );
};

// Instance method to increment load
counselorProfileSchema.methods.incrementLoad = async function(leadId) {
  if (this.currentLoad >= this.maxCapacity) {
    throw new Error('Counselor has reached maximum capacity');
  }
  this.currentLoad += 1;
  if (leadId && !this.assignedLeads.includes(leadId)) {
    this.assignedLeads.push(leadId);
  }
  return await this.save();
};

// Instance method to decrement load
counselorProfileSchema.methods.decrementLoad = async function(leadId) {
  if (this.currentLoad > 0) {
    this.currentLoad -= 1;
  }
  if (leadId) {
    this.assignedLeads = this.assignedLeads.filter(
      id => id.toString() !== leadId.toString()
    );
  }
  return await this.save();
};

// Static method to find available counselors
counselorProfileSchema.statics.findAvailable = function() {
  return this.find({
    availability: 'ACTIVE',
    $expr: { $lt: ['$currentLoad', '$maxCapacity'] }
  });
};

// Static method to find counselors by expertise
counselorProfileSchema.statics.findByExpertise = function(expertiseName) {
  return this.find({
    availability: 'ACTIVE',
    expertise: { $regex: expertiseName, $options: 'i' }
  });
};

// Static method to find counselors by language
counselorProfileSchema.statics.findByLanguage = function(language) {
  return this.find({
    availability: 'ACTIVE',
    languages: { $regex: new RegExp(`^${language}$`, 'i') }
  });
};

// Static method to find counselors with lowest load
counselorProfileSchema.statics.findLowestLoad = function(limit = 1) {
  return this.find({ availability: 'ACTIVE' })
    .sort({ currentLoad: 1 })
    .limit(limit);
};

const CounselorProfile = mongoose.model('CounselorProfile', counselorProfileSchema);

export default CounselorProfile;
