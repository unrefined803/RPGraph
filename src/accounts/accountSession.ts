// Session memory only. Never persist credentials in browser storage or settings.
let accountPassword = '';

export function setAccountSession(password: string) {
  accountPassword = password;
}

export function getAccountPassword() {
  return accountPassword;
}
