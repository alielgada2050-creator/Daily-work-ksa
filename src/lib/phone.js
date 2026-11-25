// [RULE-PHONE-FORMAT] Normalize phones with country code when it can be determined.
const MARKETS = { SA: { cc: '966', local: /^0?5\d{8}$/ }, EG: { cc: '20', local: /^0?1\d{9}$/ } };

function normalizePhone(raw, market = 'SA') {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return { value: digits, ambiguous: false };
  if (digits.startsWith('00')) return { value: `+${digits.slice(2)}`, ambiguous: false };
  const m = MARKETS[market];
  if (m && digits.startsWith(m.cc)) return { value: `+${digits}`, ambiguous: false };
  if (m && m.local.test(digits)) return { value: `+${m.cc}${digits.replace(/^0/, '')}`, ambiguous: false };
  return { value: digits, ambiguous: true };
}

module.exports = { normalizePhone };
