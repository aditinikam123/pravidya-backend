import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import CounselorProfile from '../models/CounselorProfile.js';
import Institution from '../models/Institution.js';
import Course from '../models/Course.js';
import Lead from '../models/Lead.js';
import TrainingContent from '../models/TrainingContent.js';

dotenv.config();

const seedData = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data (optional - comment out in production)
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await CounselorProfile.deleteMany({});
    await Institution.deleteMany({});
    await Course.deleteMany({});
    await Lead.deleteMany({});
    await TrainingContent.deleteMany({});

    // Create Admin User
    console.log('Creating admin user...');
    const admin = new User({
      username: 'admin',
      email: 'admin@admissions.com',
      password: 'admin123',
      role: 'ADMIN',
      isActive: true
    });
    await admin.save();
    console.log('Admin created:', admin.username);

    // Create Institutions
    console.log('Creating institutions...');
    const institutions = [
      {
        name: 'KLE Tech University',
        type: 'College',
        address: 'Hubballi',
        city: 'Hubballi',
        state: 'Karnataka',
        isActive: true
      },
      {
        name: 'KLE School',
        type: 'School',
        address: 'Belagavi',
        city: 'Belagavi',
        state: 'Karnataka',
        isActive: true
      },
      {
        name: 'ABC Engineering College',
        type: 'College',
        address: 'Bangalore',
        city: 'Bangalore',
        state: 'Karnataka',
        isActive: true
      }
    ];

    const savedInstitutions = await Institution.insertMany(institutions);
    console.log(`Created ${savedInstitutions.length} institutions`);

    // Create Courses
    console.log('Creating courses...');
    const courses = [
      {
        name: 'Computer Science Engineering',
        code: 'CSE',
        description: 'Bachelor of Engineering in Computer Science',
        institution: savedInstitutions[0]._id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'Mechanical Engineering',
        code: 'ME',
        description: 'Bachelor of Engineering in Mechanical',
        institution: savedInstitutions[0]._id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'Electronics and Communication Engineering',
        code: 'ECE',
        description: 'Bachelor of Engineering in ECE',
        institution: savedInstitutions[0]._id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'CBSE 10th Standard',
        code: 'CBSE-10',
        description: 'Central Board of Secondary Education - 10th Grade',
        institution: savedInstitutions[1]._id,
        duration: '1 Year',
        eligibility: '9th Standard',
        isActive: true
      },
      {
        name: 'Information Technology',
        code: 'IT',
        description: 'Bachelor of Engineering in Information Technology',
        institution: savedInstitutions[2]._id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      }
    ];

    const savedCourses = await Course.insertMany(courses);
    console.log(`Created ${savedCourses.length} courses`);

    // Update institutions with courses
    savedInstitutions[0].courses = [savedCourses[0]._id, savedCourses[1]._id, savedCourses[2]._id];
    savedInstitutions[1].courses = [savedCourses[3]._id];
    savedInstitutions[2].courses = [savedCourses[4]._id];
    await Promise.all(savedInstitutions.map(inst => inst.save()));

    // Create Counselor Users and Profiles
    console.log('Creating counselors...');
    const counselors = [
      {
        user: {
          username: 'counselor1',
          email: 'counselor1@admissions.com',
          password: 'counselor123',
          role: 'COUNSELOR',
          isActive: true
        },
        profile: {
          fullName: 'Rajesh Kumar',
          mobile: '9876543210',
          expertise: ['Computer Science Engineering', 'Information Technology', 'CSE'],
          languages: ['English', 'Hindi', 'Kannada'],
          availability: 'ACTIVE',
          maxCapacity: 50,
          currentLoad: 0
        }
      },
      {
        user: {
          username: 'counselor2',
          email: 'counselor2@admissions.com',
          password: 'counselor123',
          role: 'COUNSELOR',
          isActive: true
        },
        profile: {
          fullName: 'Priya Sharma',
          mobile: '9876543211',
          expertise: ['Mechanical Engineering', 'ECE'],
          languages: ['English', 'Hindi', 'Marathi'],
          availability: 'ACTIVE',
          maxCapacity: 40,
          currentLoad: 0
        }
      },
      {
        user: {
          username: 'counselor3',
          email: 'counselor3@admissions.com',
          password: 'counselor123',
          role: 'COUNSELOR',
          isActive: true
        },
        profile: {
          fullName: 'Amit Patel',
          mobile: '9876543212',
          expertise: ['Computer Science Engineering', 'CSE', 'IT'],
          languages: ['English', 'Hindi', 'Gujarati'],
          availability: 'ACTIVE',
          maxCapacity: 60,
          currentLoad: 0
        }
      },
      {
        user: {
          username: 'counselor4',
          email: 'counselor4@admissions.com',
          password: 'counselor123',
          role: 'COUNSELOR',
          isActive: true
        },
        profile: {
          fullName: 'Sneha Reddy',
          mobile: '9876543213',
          expertise: ['CBSE 10th Standard', 'School Admissions'],
          languages: ['English', 'Telugu', 'Kannada'],
          availability: 'ACTIVE',
          maxCapacity: 30,
          currentLoad: 0
        }
      }
    ];

    const createdCounselors = [];
    for (const counselorData of counselors) {
      const user = new User(counselorData.user);
      await user.save();

      const profile = new CounselorProfile({
        ...counselorData.profile,
        userId: user._id
      });
      await profile.save();

      user.counselorProfile = profile._id;
      await user.save();

      createdCounselors.push({ user, profile });
    }
    console.log(`Created ${createdCounselors.length} counselors`);

    // Create Sample Leads
    console.log('Creating sample leads...');
    const sampleLeads = [
      {
        parentName: 'Ramesh Singh',
        parentMobile: '9876543201',
        parentEmail: 'ramesh.singh@example.com',
        parentCity: 'Bangalore',
        preferredLanguage: 'Hindi',
        studentName: 'Arjun Singh',
        dateOfBirth: new Date('2005-06-15'),
        gender: 'Male',
        currentClass: '12th',
        boardUniversity: 'CBSE',
        marksPercentage: 85,
        institution: savedInstitutions[0]._id,
        course: savedCourses[0]._id,
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'Interested in CSE program',
        consent: true,
        classification: 'RAW',
        priority: 'NORMAL',
        status: 'NEW'
      },
      {
        parentName: 'Lakshmi Nair',
        parentMobile: '9876543202',
        parentEmail: 'lakshmi.nair@example.com',
        parentCity: 'Kochi',
        preferredLanguage: 'English',
        studentName: 'Ananya Nair',
        dateOfBirth: new Date('2006-03-20'),
        gender: 'Female',
        currentClass: '10th',
        boardUniversity: 'CBSE',
        marksPercentage: 92,
        institution: savedInstitutions[1]._id,
        course: savedCourses[3]._id,
        academicYear: '2024-2025',
        preferredCounselingMode: 'Offline',
        notes: 'Looking for school admission',
        consent: true,
        classification: 'RAW',
        priority: 'NORMAL',
        status: 'NEW'
      }
    ];

    const savedLeads = await Lead.insertMany(sampleLeads);
    console.log(`Created ${savedLeads.length} sample leads`);

    // Create Training Content
    console.log('Creating training content...');
    const trainingContent = [
      {
        title: 'Introduction to Admissions Process',
        description: 'Overview of the complete admissions workflow',
        type: 'VIDEO',
        fileUrl: 'https://example.com/videos/intro.mp4',
        uploadedBy: admin._id,
        isActive: true
      },
      {
        title: 'Counseling Best Practices',
        description: 'Guidelines for effective student counseling',
        type: 'DOCUMENT',
        fileUrl: 'https://example.com/docs/counseling-guide.pdf',
        fileName: 'counseling-guide.pdf',
        uploadedBy: admin._id,
        isActive: true
      },
      {
        title: 'Course Information Handbook',
        description: 'Complete guide to all available courses',
        type: 'DOCUMENT',
        fileUrl: 'https://example.com/docs/course-handbook.pdf',
        fileName: 'course-handbook.pdf',
        uploadedBy: admin._id,
        isActive: true
      }
    ];

    const savedTraining = await TrainingContent.insertMany(trainingContent);
    console.log(`Created ${savedTraining.length} training content items`);

    console.log('\n✅ Seed data created successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('Admin:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('\nCounselors:');
    console.log('  Username: counselor1, counselor2, counselor3, counselor4');
    console.log('  Password: counselor123');
    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
};

seedData();
