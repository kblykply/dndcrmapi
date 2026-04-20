import { memoryStorage } from "multer";

export const customerUploadConfig = {
  storage: memoryStorage(), // 🔥 IMPORTANT CHANGE

  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
};