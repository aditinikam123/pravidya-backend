import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.PRAVIDYA_JWT_SECRET;
const JWT_EXPIRE = process.env.PRAVIDYA_JWT_EXPIRE || '7d';

export const generatePravidyaToken = (userId, academyId, role) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET or PRAVIDYA_JWT_SECRET must be set');
  }
  return jwt.sign(
    { userId, academyId, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

export const verifyPravidyaToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
