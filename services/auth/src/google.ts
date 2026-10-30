import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface GoogleVerifier {
  /** Verify a Google Sign-In ID token from the browser; null if invalid. */
  verify(idToken: string): Promise<GoogleProfile | null>;
}

export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return {
    async verify(idToken) {
      try {
        const ticket = await client.verifyIdToken({ idToken, audience: clientId });
        const p = ticket.getPayload();
        if (!p?.sub || !p.email) return null;
        return {
          googleId: p.sub,
          email: p.email.toLowerCase(),
          emailVerified: p.email_verified === true,
          name: p.name ?? p.email,
        };
      } catch {
        return null;
      }
    },
  };
}
