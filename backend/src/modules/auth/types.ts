export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerifiedAt?: string | null;
}

export interface UserSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}
export interface AccountAccess {
  user: UserAccount;
  accessToken: string;
  expiresAt: string;
}
