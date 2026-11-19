// Why the Lock screen is off. An admin has no manager to ask: their PIN is set in their own Access settings.
export const pinHint = (role, long = false) => (role === 'admin'
  ? 'Needs a PIN. Set your PIN in your Access settings.'
  : `Needs a PIN. Ask your manager to set one${long ? ' for you' : ''}.`);
