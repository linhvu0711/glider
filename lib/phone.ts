const MIN_DIGITS = 8;
// E.164 caps a number at 15 digits.
const MAX_DIGITS = 15;

function strip(text: string): string {
  return text.replace(/[\s\-()[\]]/g, '');
}

export function checkPhone(
  countryCode: string,
  number: string,
): { ok: true; phone: string } | { ok: false; error: string } {
  const country = strip(countryCode);
  if (!/^\+?\d{1,4}$/.test(country)) {
    return { ok: false, error: 'Enter a country code, like +84.' };
  }
  const local = strip(number);
  if (local === '') return { ok: false, error: 'Enter your phone number.' };
  if (!/^\d+$/.test(local)) return { ok: false, error: 'Use digits only.' };
  const phone = country.replace('+', '') + local;
  if (phone.length < MIN_DIGITS) return { ok: false, error: 'This number is too short.' };
  if (phone.length > MAX_DIGITS) return { ok: false, error: 'This number is too long.' };
  return { ok: true, phone };
}
