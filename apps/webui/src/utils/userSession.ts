/**
 * 用户会话：登录状态与当前用户信息，持久化到 localStorage。
 *
 * 未登录时返回 null，调用方（如 chat service）回退到后端默认用户 'default'，
 * 从而保持「无登录也可用」的既有体验；一旦登录，所有请求按 user.id 隔离。
 */

export interface ChatUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
}

export interface LoginPayload {
  token: string;
  user: ChatUser;
}

const STORAGE_KEY = 'blooms_claw.currentUser';
const TOKEN_KEY = 'blooms_claw.token';

type UserListener = (user: ChatUser | null) => void;
const listeners = new Set<UserListener>();

export function getStoredUser(): ChatUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const user = JSON.parse(raw) as ChatUser;
    if (user && typeof user.id === 'string' && user.id) {
      return user;
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(payload: LoginPayload): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.user));
  localStorage.setItem(TOKEN_KEY, payload.token);
  listeners.forEach((listener) => listener(payload.user));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
  listeners.forEach((listener) => listener(null));
}

/** 当前用户 id；未登录回退到后端默认用户 */
export function getCurrentUserId(): string {
  return getStoredUser()?.id ?? 'default';
}

/** 订阅用户变化（登录/退出），返回取消订阅函数 */
export function subscribeUserChange(listener: UserListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
