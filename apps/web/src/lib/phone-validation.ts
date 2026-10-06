export const PHONE_INPUT_PATTERN = "\\+?[0-9()\\-\\s.]{7,32}";

const PHONE_REGEX = new RegExp(`^${PHONE_INPUT_PATTERN}$`);

export function isValidPhoneNumber(value: string) {
  const phone = value.trim();

  return phone.length > 0 && PHONE_REGEX.test(phone);
}
