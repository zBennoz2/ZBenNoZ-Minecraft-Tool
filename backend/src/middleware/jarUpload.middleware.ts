import os from 'os';
import path from 'path';
import multer from 'multer';

export const MAX_JAR_UPLOAD_BYTES = Number.parseInt(process.env.MAX_JAR_UPLOAD_BYTES ?? '', 10) || 500 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, _file, cb) => cb(null, `jar-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.jar`),
});

export const jarUpload = multer({
  storage,
  limits: { fileSize: MAX_JAR_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!path.basename(file.originalname).toLowerCase().endsWith('.jar')) return cb(new Error('ONLY_JAR'));
    cb(null, true);
  },
});
