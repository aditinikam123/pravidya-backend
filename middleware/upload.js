import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Training files: backend/media/training/
const mediaRoot = path.join(__dirname, '..', 'media');
const trainingDir = path.join(mediaRoot, 'training');

// Ensure directories exist
if (!fs.existsSync(mediaRoot)) fs.mkdirSync(mediaRoot, { recursive: true });
if (!fs.existsSync(trainingDir)) fs.mkdirSync(trainingDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, trainingDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '') || 'file';
    // Unique name: timestamp + random + base + ext (avoids overwrites)
    const unique = Date.now() + '-' + Math.random().toString(36).slice(2, 11) + '-' + base + ext;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB
  },
  fileFilter: (_req, file, cb) => {
    // Video, PDF, images
    const allowedExt = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xlsx|xls|ppt|pptx|mp4|avi|mov|wmv|webm|m4v|mp3|wav/i;
    const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
    if (!ext || allowedExt.test(ext)) return cb(null, true);
    cb(new Error('Invalid file type. Allowed: video, PDF, images (JPEG, PNG, GIF, WebP), DOC, XLS, PPT.'));
  }
});

export default upload;
