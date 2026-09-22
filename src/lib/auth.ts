/**
 * NextAuth v4 setup with Credentials provider.
 * - bcrypt-hashed admin password
 * - JWT session (stateless, httpOnly cookie)
 * - Single-admin model — one row in Admin table
 *
 * The single admin row is created from env when missing and kept in sync with
 * ADMIN_EMAIL / ADMIN_PASSWORD so credential changes take effect without a DB reset.
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

async function ensureAdminSeed() {
  const admin = await db.admin.findFirst();
  const hashMatches = admin
    ? bcrypt.compareSync(env.ADMIN_PASSWORD, admin.passwordHash)
    : false;

  if (!admin) {
    await db.admin.create({
      data: {
        email: env.ADMIN_EMAIL,
        passwordHash: bcrypt.hashSync(env.ADMIN_PASSWORD, 12),
        name: "Admin",
      },
    });
    logger.info("Seeded initial admin from env", { email: env.ADMIN_EMAIL });
  } else if (admin.email !== env.ADMIN_EMAIL || !hashMatches) {
    await db.admin.update({
      where: { id: admin.id },
      data: {
        email: env.ADMIN_EMAIL,
        passwordHash: hashMatches ? admin.passwordHash : bcrypt.hashSync(env.ADMIN_PASSWORD, 12),
      },
    });
    logger.info("Synchronized admin credentials from env", { email: env.ADMIN_EMAIL });
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 }, // 7 days
  secret: env.AUTH_SECRET,
  // Use NextAuth default cookie names so middleware (`withAuth`) reads them correctly.
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        await ensureAdminSeed();
        const admin = await db.admin.findFirst({
          where: { email: creds.email.toLowerCase() },
        });
        if (!admin) return null;
        const ok = bcrypt.compareSync(creds.password, admin.passwordHash);
        if (!ok) return null;
        return { id: String(admin.id), email: admin.email, name: admin.name ?? "Admin" };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string | undefined;
        session.user.email = token.email as string;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};
