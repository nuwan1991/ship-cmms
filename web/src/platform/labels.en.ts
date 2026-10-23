/** Shared shell labels (sign-in, account, authority banners). Module labels live with their module. */
export const platformLabelsEn: Record<string, string> = {
  'auth.signin': 'Sign in',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.submit': 'Sign in',
  'auth.signout': 'Sign out',
  'auth.signed_in_as': 'Signed in as {name}',
  'auth.change_password': 'Change password',
  'auth.current_password': 'Current password',
  'auth.new_password': 'New password',
  'auth.password_changed': 'Password changed.',
  'shell.authority_expired': 'Offline authority on this installation has expired. Routine work continues; approvals are recorded as pending confirmation and administration is blocked until it synchronizes with headquarters.',
  'shell.lease_until': 'Offline authority valid until {when}',
  'shell.clock_suspect': 'The system clock is behind the last recorded time. Approvals are blocked until an administrator resets the clock.',
  'shell.loading': 'Loading…',
};
