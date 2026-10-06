export const EMAIL_INPUT_PATTERN = "[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}";

const EMAIL_REGEX = new RegExp(`^${EMAIL_INPUT_PATTERN}$`);

export function isValidEmailAddress(value: string) {
  const email = value.trim();

  return email.length > 0 && email.length <= 254 && EMAIL_REGEX.test(email);
}
