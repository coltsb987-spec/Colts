// Password rules for CoachBook sign-up and resets.
// Length matters most (NCSC guidance), so: at least 10 characters, not a well-known
// password, not built from the person's email, and not one repeated character.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 72; // Supabase/bcrypt limit

const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "qwerty", "qwertyuiop", "qwerty123",
  "1234567890", "0987654321", "123456789", "1q2w3e4r5t", "iloveyou", "letmein", "welcome", "welcome1", "welcome123",
  "football", "football1", "football123", "liverpool", "manchester", "manutd", "chelsea", "arsenal", "tottenham",
  "coachbook", "coaching", "soccer", "abc123456", "aaaaaaaaaa", "trustno1", "dragon", "monkey", "sunshine", "princess",
  "baseball", "superman", "starwars", "admin123", "changeme", "default", "secret123", "summer2026", "winter2026",
]);

/** Returns a plain-words problem with the password, or null if it's fine. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters – a few words together works well.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  const lower = password.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, "");
  if (COMMON.has(lower) || COMMON.has(squashed) || COMMON.has(squashed.replace(/\d+$/, ""))) return "That password is too common. Try three random words, like “kettle-goalpost-orbit”.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower)) return "That password is too easy to guess.";
  const name = email?.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name && name.length >= 4 && squashed.includes(name)) return "Don't include your email address in your password.";
  return null;
}
