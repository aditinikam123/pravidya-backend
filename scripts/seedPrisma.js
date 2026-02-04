import dotenv from 'dotenv';
import { prisma } from '../prisma/client.js';
import { hashPassword } from '../utils/password.js';
import assignmentEngine from '../services/assignmentEngine.js';

dotenv.config();

const seedData = async () => {
  try {
    console.log('🌱 Starting seed data creation...\n');

    // Clear existing data (optional - comment out in production)
    console.log('Clearing existing data...');
    await prisma.activityLog.deleteMany({});
    await prisma.todo.deleteMany({});
    await prisma.trainingContent.deleteMany({});
    await prisma.counselingSession.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.course.deleteMany({});
    await prisma.institution.deleteMany({});
    await prisma.counselorProfile.deleteMany({});
    await prisma.user.deleteMany({});
    console.log('✅ Existing data cleared\n');

    // Create Admin User
    console.log('Creating admin user...');
    const adminPassword = await hashPassword('admin123');
    const admin = await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@admissions.com',
        password: adminPassword,
        role: 'ADMIN',
        isActive: true
      }
    });
    console.log('✅ Admin created:', admin.username);

    // Create Institutions
    console.log('\nCreating institutions...');
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

    const savedInstitutions = [];
    for (const inst of institutions) {
      const saved = await prisma.institution.create({ data: inst });
      savedInstitutions.push(saved);
    }
    console.log(`✅ Created ${savedInstitutions.length} institutions`);

    // Create Courses
    console.log('\nCreating courses...');
    const courses = [
      {
        name: 'Computer Science Engineering',
        code: 'CSE',
        description: 'Bachelor of Engineering in Computer Science',
        institutionId: savedInstitutions[0].id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'Electronics and Communication Engineering',
        code: 'ECE',
        description: 'Bachelor of Engineering in ECE',
        institutionId: savedInstitutions[0].id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'Mechanical Engineering',
        code: 'ME',
        description: 'Bachelor of Engineering in Mechanical',
        institutionId: savedInstitutions[0].id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      },
      {
        name: 'CBSE 10th Standard',
        code: 'CBSE-10',
        description: 'Central Board of Secondary Education - 10th Grade',
        institutionId: savedInstitutions[1].id,
        duration: '1 Year',
        eligibility: '9th Standard',
        isActive: true
      },
      {
        name: 'Information Technology',
        code: 'IT',
        description: 'Bachelor of Engineering in Information Technology',
        institutionId: savedInstitutions[2].id,
        duration: '4 Years',
        eligibility: '12th with PCM',
        isActive: true
      }
    ];

    const savedCourses = [];
    for (const course of courses) {
      const saved = await prisma.course.create({ data: course });
      savedCourses.push(saved);
    }
    console.log(`✅ Created ${savedCourses.length} courses`);

    // Create Counselor Users and Profiles
    console.log('\nCreating counselors...');
    const counselorPassword = await hashPassword('counselor123');
    const counselors = [
      {
        user: {
          username: 'counselor1',
          email: 'counselor1@admissions.com',
          password: counselorPassword,
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
          password: counselorPassword,
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
          password: counselorPassword,
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
          password: counselorPassword,
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
      const user = await prisma.user.create({
        data: counselorData.user
      });

      const profile = await prisma.counselorProfile.create({
        data: {
          ...counselorData.profile,
          userId: user.id
        }
      });

      createdCounselors.push({ user, profile });
    }
    console.log(`✅ Created ${createdCounselors.length} counselors`);

    // Create Sample Leads
    console.log('\nCreating sample leads...');
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
        marksPercentage: 85.5,
        institutionId: savedInstitutions[0].id,
        courseId: savedCourses[0].id, // CSE
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'Interested in CSE program. Good academic record.',
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
        marksPercentage: 92.0,
        institutionId: savedInstitutions[1].id,
        courseId: savedCourses[3].id, // CBSE 10th
        academicYear: '2024-2025',
        preferredCounselingMode: 'Offline',
        notes: 'Looking for school admission',
        consent: true,
        classification: 'VERIFIED',
        priority: 'HIGH',
        status: 'CONTACTED'
      },
      {
        parentName: 'Vikram Reddy',
        parentMobile: '9876543203',
        parentEmail: 'vikram.reddy@example.com',
        parentCity: 'Hyderabad',
        preferredLanguage: 'Telugu',
        studentName: 'Rahul Reddy',
        dateOfBirth: new Date('2005-11-10'),
        gender: 'Male',
        currentClass: '12th',
        boardUniversity: 'State Board',
        marksPercentage: 78.5,
        institutionId: savedInstitutions[0].id,
        courseId: savedCourses[1].id, // ECE
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'Interested in Electronics and Communication',
        consent: true,
        classification: 'RAW',
        priority: 'NORMAL',
        status: 'NEW'
      },
      {
        parentName: 'Priya Desai',
        parentMobile: '9876543204',
        parentEmail: 'priya.desai@example.com',
        parentCity: 'Mumbai',
        preferredLanguage: 'Marathi',
        studentName: 'Siddharth Desai',
        dateOfBirth: new Date('2005-08-25'),
        gender: 'Male',
        currentClass: '12th',
        boardUniversity: 'HSC',
        marksPercentage: 88.0,
        institutionId: savedInstitutions[0].id,
        courseId: savedCourses[0].id, // CSE
        academicYear: '2024-2025',
        preferredCounselingMode: 'Offline',
        notes: 'High priority - excellent marks',
        consent: true,
        classification: 'PRIORITY',
        priority: 'HIGH',
        status: 'FOLLOW_UP'
      },
      {
        parentName: 'Anil Kumar',
        parentMobile: '9876543205',
        parentEmail: 'anil.kumar@example.com',
        parentCity: 'Delhi',
        preferredLanguage: 'Hindi',
        studentName: 'Rohit Kumar',
        dateOfBirth: new Date('2005-02-14'),
        gender: 'Male',
        currentClass: '12th',
        boardUniversity: 'CBSE',
        marksPercentage: 75.0,
        institutionId: savedInstitutions[2].id,
        courseId: savedCourses[4].id, // IT
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'Interested in IT program',
        consent: true,
        classification: 'RAW',
        priority: 'NORMAL',
        status: 'NEW'
      },
      {
        parentName: 'Sunita Patel',
        parentMobile: '9876543206',
        parentEmail: 'sunita.patel@example.com',
        parentCity: 'Ahmedabad',
        preferredLanguage: 'Gujarati',
        studentName: 'Kavya Patel',
        dateOfBirth: new Date('2006-05-30'),
        gender: 'Female',
        currentClass: '10th',
        boardUniversity: 'GSEB',
        marksPercentage: 90.5,
        institutionId: savedInstitutions[1].id,
        courseId: savedCourses[3].id, // CBSE 10th
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'School admission enquiry',
        consent: true,
        classification: 'VERIFIED',
        priority: 'NORMAL',
        status: 'CONTACTED'
      },
      {
        parentName: 'Rajesh Iyer',
        parentMobile: '9876543207',
        parentEmail: 'rajesh.iyer@example.com',
        parentCity: 'Chennai',
        preferredLanguage: 'Tamil',
        studentName: 'Aditya Iyer',
        dateOfBirth: new Date('2005-09-18'),
        gender: 'Male',
        currentClass: '12th',
        boardUniversity: 'State Board',
        marksPercentage: 82.0,
        institutionId: savedInstitutions[0].id,
        courseId: savedCourses[2].id, // ME
        academicYear: '2024-2025',
        preferredCounselingMode: 'Offline',
        notes: 'Interested in Mechanical Engineering',
        consent: true,
        classification: 'RAW',
        priority: 'NORMAL',
        status: 'NEW'
      },
      {
        parentName: 'Meera Joshi',
        parentMobile: '9876543208',
        parentEmail: 'meera.joshi@example.com',
        parentCity: 'Pune',
        preferredLanguage: 'Marathi',
        studentName: 'Sneha Joshi',
        dateOfBirth: new Date('2005-12-05'),
        gender: 'Female',
        currentClass: '12th',
        boardUniversity: 'HSC',
        marksPercentage: 95.0,
        institutionId: savedInstitutions[0].id,
        courseId: savedCourses[0].id, // CSE
        academicYear: '2024-2025',
        preferredCounselingMode: 'Online',
        notes: 'Excellent academic record - priority candidate',
        consent: true,
        classification: 'PRIORITY',
        priority: 'URGENT',
        status: 'FOLLOW_UP'
      }
    ];

    const createdLeads = [];
    let leadCounter = 1;
    
    for (const leadData of sampleLeads) {
      // Generate unique leadId (format: LEAD-YYYYMMDD-XXXX)
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
      const sequenceNum = leadCounter.toString().padStart(4, '0');
      const leadId = `LEAD-${dateStr}-${sequenceNum}`;
      leadCounter++;

      // Create lead with leadId
      const lead = await prisma.lead.create({
        data: {
          ...leadData,
          leadId
        }
      });

      // Automatic counselor assignment
      try {
        const assignmentResult = await assignmentEngine.findBestCounselor(lead);
        await assignmentEngine.assignLead(lead, assignmentResult);
        
        // Reload lead to get updated assignment info
        const updatedLead = await prisma.lead.findUnique({
          where: { id: lead.id },
          include: {
            assignedCounselor: {
              select: { fullName: true }
            }
          }
        });
        createdLeads.push(updatedLead);
      } catch (error) {
        console.error(`Error assigning lead ${lead.leadId}:`, error.message);
        createdLeads.push(lead);
      }
    }
    console.log(`✅ Created ${createdLeads.length} sample leads`);
    
    // Show assignment summary
    const assignedCount = createdLeads.filter(l => l.assignedCounselorId).length;
    console.log(`   - ${assignedCount} leads assigned to counselors`);
    console.log(`   - ${createdLeads.length - assignedCount} leads unassigned`);

    console.log('\n✅ Seed data created successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('  Email: admin@admissions.com');
    console.log('\nCounselors:');
    console.log('  Usernames: counselor1, counselor2, counselor3, counselor4');
    console.log('  Password: counselor123');
    console.log('\n📊 Sample Data:');
    console.log(`  Institutions: ${savedInstitutions.length}`);
    console.log(`  Courses: ${savedCourses.length}`);
    console.log(`  Counselors: ${createdCounselors.length}`);
    console.log(`  Sample Leads: ${createdLeads.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

seedData();
