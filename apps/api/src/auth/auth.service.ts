import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  createdAt: string;
}

interface StoredUser extends AuthUser { passwordHash: string; }

@Injectable()
export class AuthService {
  private readonly filePath = path.join(os.homedir(), '.blooms_claw', 'users.json');
  private readonly secret = process.env.BLOOMS_CLAW_AUTH_SECRET || 'blooms-claw-local-secret';

  register(username: string, password: string, displayName?: string) {
    const normalized = String(username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,64}$/.test(normalized) || String(password ?? '').length < 6) {
      throw new UnauthorizedException('用户名至少 3 位且只能包含字母、数字、._-；密码至少 6 位');
    }
    const users = this.readUsers();
    if (users.some((user) => user.username === normalized)) throw new ConflictException('用户名已存在');
    const user: StoredUser = {
      id: crypto.randomUUID(), username: normalized,
      displayName: String(displayName ?? '').trim() || normalized,
      createdAt: new Date().toISOString(), passwordHash: this.hashPassword(password),
    };
    users.push(user); this.writeUsers(users);
    return this.issue(user);
  }

  login(username: string, password: string) {
    const user = this.readUsers().find((item) => item.username === String(username ?? '').trim().toLowerCase());
    if (!user || !this.verifyPassword(password, user.passwordHash)) throw new UnauthorizedException('用户名或密码错误');
    return this.issue(user);
  }

  verifyToken(token?: string): AuthUser {
    if (!token) throw new UnauthorizedException('未登录');
    const [encoded, signature] = token.split('.');
    const expected = this.sign(encoded ?? '');
    if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException('登录已失效');
    const user = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { id: string; exp: number };
    if (user.exp < Date.now()) throw new UnauthorizedException('登录已失效');
    const stored = this.readUsers().find((item) => item.id === user.id);
    if (!stored) throw new UnauthorizedException('用户不存在');
    return this.publicUser(stored);
  }

  private issue(user: StoredUser) {
    const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
    return { token: `${payload}.${this.sign(payload)}`, user: this.publicUser(user) };
  }
  private publicUser(user: StoredUser): AuthUser { const { passwordHash: _passwordHash, ...publicUser } = user; return publicUser; }
  private hashPassword(password: string) { return crypto.scryptSync(password, this.secret, 64).toString('hex'); }
  private verifyPassword(password: string, hash: string) { return crypto.timingSafeEqual(Buffer.from(this.hashPassword(password), 'hex'), Buffer.from(hash, 'hex')); }
  private sign(value: string) { return crypto.createHmac('sha256', this.secret).update(value).digest('base64url'); }
  private readUsers(): StoredUser[] { try { return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as StoredUser[]; } catch { return []; } }
  private writeUsers(users: StoredUser[]) { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); fs.writeFileSync(this.filePath, JSON.stringify(users, null, 2)); }
}
