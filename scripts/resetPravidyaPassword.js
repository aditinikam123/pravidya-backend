/**
 * Reset Pravidya academy user password and unlock account.
 * Usage: node scripts/resetPravidyaPassword.js [email] [academySlug]
 * Example: node scripts/resetPravidyaPassword.js shrutibalekundri7@gmail.com veeman
 * Default: shrutibalekundri7@gmail.com / veeman
 */
import { prisma } from '../prismaClient.js';
import { hashPassword } from '../utils/password.js';

const email = process.argv[2] || 'shrutibalekundri7@gmail.com';
const academySlug = process.argv[3] || 'veeman';
const newPassword = 'Veman@123';

async function main() {
  const academy = await prisma.academy.findUnique({
    where: { slug: academySlug.toLowerCase() },
  });
  if (!academy) {
    console.error('Academy not found:', academySlug);
    process.exit(1);
  }

  const user = await prisma.academyUser.findUnique({
    where: {
      academyId_email: { academyId: academy.id, email: email.toLowerCase() },
    },
  });
  if (!user) {
    console.error('User not found:', email, 'in academy', academySlug);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.academyUser.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordLastChanged: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  console.log('Password reset and account unlocked.');
  console.log('Email:', email);
  console.log('Academy:', academySlug);
  console.log('New password:', newPassword);
  console.log('Login at: http://localhost:3000/pravidya/acme/' + academySlug + '/login?role=ADMIN');
}

main().catch(console.error).finally(() => prisma.$disconnect());
