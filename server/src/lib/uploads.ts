import fs from 'fs';
import path from 'path';
import { UPLOAD_DIR } from '../middleware/upload';

export function deleteImageFile(imagePath: string | null) {
  if (!imagePath) return;
  const full = path.join(UPLOAD_DIR, path.basename(imagePath));
  fs.unlink(full, () => {});
}
