/**
 * Enterprise lead import: validation, duplicate detection, row-level errors.
 * Required columns: studentName, parentName, parentPhone, institution, course
 * Optional: parentEmail, studentGrade, preferredLanguage, location, notes
 */

import ExcelJS from 'exceljs';
import { prisma } from '../prisma/client.js';

const REQUIRED_HEADERS = ['studentname', 'parentname', 'parentphone', 'institution', 'course'];
const OPTIONAL_HEADERS = ['parentemail', 'studentgrade', 'preferredlanguage', 'location', 'notes'];
const ALLOWED_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

const VALID_LANGUAGES = ['English', 'Hindi', 'Kannada', 'Telugu', 'Marathi', 'Tamil', 'Other'];
const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/** Normalize phone: exactly 10 digits, numeric only. Strip +91, spaces, dashes. */
function normalizePhone(value) {
  if (value == null || value === '') return '';
  let s = String(value).replace(/\s+/g, '').replace(/[-()]/g, '');
  const match = s.replace(/^\+91/, '').replace(/\D/g, '');
  return match.length === 10 ? match : String(value).trim();
}

function isPhoneValid(value) {
  const normalized = normalizePhone(value);
  return /^\d{10}$/.test(normalized);
}

/** Normalize header: trim, lowercase for comparison */
function normalizeHeader(h) {
  return (h || '').toString().trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Validate Excel headers. Returns { valid, missingRequired, unknownColumns }.
 */
export function validateHeaders(worksheet) {
  const row1 = worksheet.getRow(1);
  const rawHeaders = [];
  row1.eachCell((cell) => rawHeaders.push((cell.value ?? '').toString().trim()));
  const headerMap = buildHeaderMap(rawHeaders);
  const normalized = rawHeaders.map(normalizeHeader).filter(Boolean);
  const allowedNormalized = new Set([...ALLOWED_HEADERS, ...Object.values(HEADER_ALIASES).flat()]);
  const missingRequired = REQUIRED_HEADERS.filter((req) => !headerMap[req]);
  const unknownColumns = normalized.filter((n) => !allowedNormalized.has(n));
  return {
    valid: missingRequired.length === 0 && unknownColumns.length === 0,
    missingRequired: missingRequired.map((m) => headerDisplayName(m)),
    unknownColumns: unknownColumns.map((u) => headerDisplayName(u)),
    headerMap,
  };
}

function headerDisplayName(normalized) {
  const map = {
    studentname: 'studentName',
    parentname: 'parentName',
    parentphone: 'parentPhone',
    institution: 'institution',
    course: 'course',
    parentemail: 'parentEmail',
    studentgrade: 'studentGrade',
    preferredlanguage: 'preferredLanguage',
    location: 'location',
    notes: 'notes',
  };
  return map[normalized] || normalized;
}

const HEADER_ALIASES = {
  studentname: ['student_name', 'studentname'],
  parentname: ['parent_name', 'parentname'],
  parentphone: ['parent_mobile', 'parent_phone', 'parentphone'],
  institution: ['institution_name', 'institution'],
  course: ['course_name', 'course'],
  parentemail: ['parent_email', 'parentemail'],
  studentgrade: ['student_grade', 'current_class', 'studentgrade'],
  preferredlanguage: ['preferred_language', 'preferredlanguage'],
  location: ['location', 'parent_city', 'city'],
  notes: ['notes'],
};

function buildHeaderMap(rawHeaders) {
  const map = {};
  rawHeaders.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (n) map[n] = i + 1; // 1-based column index
  });
  // Apply aliases so both "studentName" and "student_name" work
  Object.entries(HEADER_ALIASES).forEach(([canonical, aliases]) => {
    if (map[canonical]) return;
    for (const alt of aliases) {
      if (map[alt]) {
        map[canonical] = map[alt];
        break;
      }
    }
  });
  return map;
}

function getCell(row, colIndex) {
  const val = row.getCell(colIndex)?.value;
  if (val == null) return '';
  if (typeof val === 'object' && val.result !== undefined) return String(val.result ?? '').trim();
  return String(val).trim();
}

/**
 * Parse and validate all rows. Collect rowErrors, duplicates (DB + in-file), languageWarnings, emailWarnings.
 */
export async function previewImport(worksheet, headerMap) {
  const rowErrors = []; // { rowNumber, errorType, message }
  const duplicates = []; // { rowNumber, parentPhone, studentName, course, existingLeadId? }
  const inFileDuplicateRows = []; // { rowNumbers: [5, 18] } for same lead key in file
  const languageWarnings = [];
  const emailWarnings = [];
  const seenKeys = new Map(); // key -> first row number (for in-file duplicates)

  const totalRows = worksheet.rowCount - 1;
  const LARGE_FILE_THRESHOLD = 5000;
  const largeFileWarning = totalRows > LARGE_FILE_THRESHOLD;

  let rowNumber = 1;
  worksheet.eachRow((row, idx) => {
    rowNumber = idx;
    if (idx === 1) return; // skip header

    const get = (key) => getCell(row, headerMap[key] || 0);
    const studentName = get('studentname');
    const parentName = get('parentname');
    const rawPhone = get('parentphone');
    const institution = get('institution');
    const course = get('course');
    const parentEmail = get('parentemail');
    const preferredLanguage = get('preferredlanguage');

    // Empty row → silently ignore
    if (!studentName && !parentName && !rawPhone && !institution && !course) return;

    const phone = normalizePhone(rawPhone);
    const dupKey = `${phone}|${(studentName || '').trim()}|${(course || '').trim()}`;

    const errors = [];

    if (!studentName) errors.push('Missing student name');
    if (!parentName) errors.push('Missing parent name');
    if (!rawPhone) errors.push('Missing parent phone');
    else if (!isPhoneValid(rawPhone)) errors.push('Invalid phone number (must be exactly 10 digits, numeric only)');
    if (!institution) errors.push('Missing institution');
    if (!course) errors.push('Missing course');

    if (errors.length > 0) {
      rowErrors.push({ rowNumber, errorType: 'Required fields', message: errors.join('; ') });
      return;
    }

    if (parentEmail && !EMAIL_REGEX.test(parentEmail)) {
      emailWarnings.push({ rowNumber, message: `Row ${rowNumber} → Invalid email format. Row will be imported without email.` });
    }

    if (preferredLanguage && !VALID_LANGUAGES.some((l) => l.toLowerCase() === preferredLanguage.toLowerCase())) {
      languageWarnings.push({ rowNumber, value: preferredLanguage, message: `Row ${rowNumber} → Language "${preferredLanguage}" not recognized. Row will be imported without language preference.` });
    }

    if (seenKeys.has(dupKey)) {
      const firstRow = seenKeys.get(dupKey);
      const pair = inFileDuplicateRows.find((p) => p.rowNumbers.includes(firstRow));
      if (pair) {
        if (!pair.rowNumbers.includes(idx)) pair.rowNumbers.push(idx);
      } else {
        inFileDuplicateRows.push({ rowNumbers: [firstRow, idx] });
      }
      return;
    }
    seenKeys.set(dupKey, idx);
  });

  // DB duplicate check for rows that passed required validation (use same loop data - we need to re-iterate or collect valid rows)
  const validRows = [];
  rowNumber = 1;
  worksheet.eachRow((row, idx) => {
    rowNumber = idx;
    if (idx === 1) return;
    const get = (key) => getCell(row, headerMap[key] || 0);
    const studentName = get('studentname');
    const parentName = get('parentname');
    const rawPhone = get('parentphone');
    const institution = get('institution');
    const course = get('course');
    if (!studentName && !parentName && !rawPhone && !institution && !course) return;
    const phone = normalizePhone(rawPhone);
    if (!studentName || !parentName || !isPhoneValid(rawPhone) || !institution || !course) return;
    const dupKey = `${phone}|${studentName.trim()}|${course.trim()}`;
    if (inFileDuplicateRows.some((p) => p.rowNumbers.includes(idx))) return;
    validRows.push({ rowNumber: idx, phone, studentName: studentName.trim(), course: course.trim(), institution: institution.trim() });
  });

  const existingLeads = await prisma.lead.findMany({
    where: {
      OR: validRows.map((r) => ({
        parentMobile: r.phone,
        studentName: { equals: r.studentName, mode: 'insensitive' },
        course: { name: { equals: r.course, mode: 'insensitive' } },
      })),
    },
    select: { id: true, parentMobile: true, studentName: true, course: { select: { name: true } } },
  });

  const existingKey = (l) => `${l.parentMobile}|${(l.studentName || '').trim()}|${(l.course?.name || '').trim()}`;
  const existingMap = new Map(existingLeads.map((l) => [existingKey(l).toLowerCase(), l]));

  validRows.forEach((r) => {
    const key = `${r.phone}|${r.studentName}|${r.course}`;
    const existing = existingMap.get(key.toLowerCase());
    if (existing) {
      duplicates.push({
        rowNumber: r.rowNumber,
        parentPhone: r.phone,
        studentName: r.studentName,
        course: r.course,
        existingLeadId: existing.id,
      });
    }
  });

  return {
    rowErrors,
    duplicates,
    inFileDuplicateRows,
    languageWarnings,
    emailWarnings,
    largeFileWarning,
    totalRows: worksheet.rowCount - 1,
  };
}

function getRowData(row, idx, headerMap) {
  const get = (key) => getCell(row, headerMap[key] || 0);
  const studentName = get('studentname');
  const parentName = get('parentname');
  const rawPhone = get('parentphone');
  const institutionName = get('institution');
  const courseName = get('course');
  const parentEmail = get('parentemail');
  const studentGrade = get('studentgrade');
  const preferredLanguage = get('preferredlanguage');
  const location = get('location');
  const notes = get('notes');
  const phone = normalizePhone(rawPhone);
  return {
    rowNumber: idx,
    studentName: studentName?.trim() || '',
    parentName: parentName?.trim() || '',
    parentMobile: phone,
    institutionName: institutionName?.trim() || '',
    courseName: courseName?.trim() || '',
    parentEmail: parentEmail?.trim() || null,
    currentClass: studentGrade?.trim() || '',
    preferredLanguage: preferredLanguage?.trim() || 'English',
    parentCity: location?.trim() || '',
    notes: notes?.trim() || null,
  };
}

/**
 * Execute import with duplicate decisions. duplicateDecisions: { [rowNumber]: 'update' | 'skip' | 'import_new' }
 * Returns { imported, skipped, updated, errorReportRows }.
 */
export async function executeImport(worksheet, headerMap, duplicateDecisions = {}) {
  const errorReportRows = [];
  const rowsToProcess = [];
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  worksheet.eachRow((row, idx) => {
    if (idx === 1) return;
    const data = getRowData(row, idx, headerMap);
    if (!data.studentName && !data.parentName && !data.parentMobile && !data.institutionName && !data.courseName) return;
    // Re-validate required fields and phone so we skip and report invalid rows
    const reqErr = [];
    if (!data.studentName) reqErr.push('Missing student name');
    if (!data.parentName) reqErr.push('Missing parent name');
    if (!data.parentMobile) reqErr.push('Missing parent phone');
    else if (!/^\d{10}$/.test(data.parentMobile)) reqErr.push('Invalid phone (must be 10 digits)');
    if (!data.institutionName) reqErr.push('Missing institution');
    if (!data.courseName) reqErr.push('Missing course');
    if (reqErr.length) {
      errorReportRows.push({ rowNumber: idx, errorType: 'Required fields', message: reqErr.join('; ') });
      skipped += 1;
      return;
    }
    rowsToProcess.push(data);
  });

  await prisma.$transaction(async (tx) => {
    for (const data of rowsToProcess) {
      const idx = data.rowNumber;
      const dupDecision = duplicateDecisions[idx];

      try {
        const institution = await tx.institution.findFirst({
          where: { name: { equals: data.institutionName, mode: 'insensitive' }, isActive: true },
          include: { courses: { where: { isActive: true } } },
        });
        if (!institution) {
          skipped += 1;
          errorReportRows.push({ rowNumber: idx, errorType: 'Course/Institution', message: `Institution "${data.institutionName}" not found` });
          continue;
        }

        const course = institution.courses.find((c) => c.name.toLowerCase() === data.courseName.toLowerCase());
        if (!course) {
          skipped += 1;
          errorReportRows.push({ rowNumber: idx, errorType: 'Course/Institution', message: `Course "${data.courseName}" not found in institution "${data.institutionName}"` });
          continue;
        }

        const existing = await tx.lead.findFirst({
          where: {
            parentMobile: data.parentMobile,
            studentName: { equals: data.studentName, mode: 'insensitive' },
            courseId: course.id,
          },
        });

        if (existing) {
          if (dupDecision === 'skip') {
            skipped += 1;
            errorReportRows.push({ rowNumber: idx, errorType: 'Duplicate', message: 'Skipped by user choice' });
            continue;
          }
          if (dupDecision === 'update') {
            await tx.lead.update({
              where: { id: existing.id },
              data: {
                parentName: data.parentName,
                parentEmail: data.parentEmail || existing.parentEmail,
                currentClass: data.currentClass || existing.currentClass,
                preferredLanguage: data.preferredLanguage || existing.preferredLanguage,
                parentCity: data.parentCity || existing.parentCity,
                notes: data.notes !== null && data.notes !== '' ? data.notes : existing.notes,
              },
            });
            updated += 1;
            continue;
          }
          if (dupDecision !== 'import_new') {
            skipped += 1;
            errorReportRows.push({ rowNumber: idx, errorType: 'Duplicate', message: 'Duplicate lead (no decision provided)' });
            continue;
          }
        }

        await tx.lead.create({
          data: {
            parentName: data.parentName,
            parentMobile: data.parentMobile,
            parentEmail: data.parentEmail || '',
            parentCity: data.parentCity || '',
            preferredLanguage: data.preferredLanguage || 'English',
            studentName: data.studentName,
            dateOfBirth: new Date('2000-01-01'),
            gender: 'Other',
            currentClass: data.currentClass || '',
            boardUniversity: null,
            marksPercentage: null,
            institutionId: institution.id,
            courseId: course.id,
            academicYear: '',
            preferredCounselingMode: 'Online',
            notes: data.notes,
            consent: true,
            classification: 'RAW',
            priority: 'NORMAL',
            status: 'NEW',
            autoAssigned: false,
            assignedCounselorId: null,
          },
        });
        imported += 1;
      } catch (err) {
        skipped += 1;
        errorReportRows.push({ rowNumber: idx, errorType: 'System', message: err.message || String(err) });
      }
    }
  });

  return { imported, skipped, updated, errorReportRows };
}

/**
 * Build error report Excel buffer (Row Number, Error Type, Error Message).
 */
export async function buildErrorReportExcel(errorReportRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import Errors');
  sheet.columns = [
    { header: 'Row Number', key: 'rowNumber', width: 12 },
    { header: 'Error Type', key: 'errorType', width: 20 },
    { header: 'Error Message', key: 'message', width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  errorReportRows.forEach((r) => sheet.addRow(r));
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
