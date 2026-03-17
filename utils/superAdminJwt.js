import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.PRAVIDYA_JWT_SECRET;
const JWT_EXPIRE = process.env.SUPER_ADMIN_JWT_EXPIRE || '7d';

export const generateSuperAdminToken = (superAdminId, institutionId) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET or PRAVIDYA_JWT_SECRET must be set');
  }
  return jwt.sign(
    { superAdminId, institutionId, role: 'SUPER_ADMIN' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

export const verifySuperAdminToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
