import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { Form, Input, Modal, Tabs, message } from 'antd';
import React, { useEffect, useState } from 'react';
import { setSession, type ChatUser } from '@/utils/userSession';

const API_BASE_URL = process.env.CHAT_STREAM_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';

interface AuthResponse { token: string; user: ChatUser; }
interface AuthEnvelope { data?: AuthResponse; msg?: string; message?: string; }

const parseAuthResponse = (body: unknown): AuthResponse => {
  let parsed = body;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new Error('登录响应无效，请重试');
    }
  }

  const candidate = parsed && typeof parsed === 'object' && 'data' in parsed
    ? (parsed as AuthEnvelope).data
    : parsed;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (candidate as AuthResponse).token !== 'string' ||
    !(candidate as AuthResponse).user ||
    typeof (candidate as AuthResponse).user.id !== 'string'
  ) {
    throw new Error('登录响应无效，请重试');
  }
  return candidate as AuthResponse;
};

const toErrorMessage = (body: unknown): string => {
  if (typeof body === 'string') {
    try { return toErrorMessage(JSON.parse(body) as unknown); } catch { return body || '请求失败，请重试'; }
  }
  if (body && typeof body === 'object') {
    const value = body as AuthEnvelope;
    if (typeof value.message === 'string' && value.message) return value.message;
    if (typeof value.msg === 'string' && value.msg) return value.msg;
  }
  return '请求失败，请重试';
};

export interface UserAuthModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: 'login' | 'register';
}

export const UserAuthModal: React.FC<UserAuthModalProps> = ({ open, onClose, initialTab = 'login' }) => {
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(initialTab);
  const [submitting, setSubmitting] = useState(false);
  const { setInitialState } = useModel('@@initialState');

  useEffect(() => { if (open) setActiveTab(initialTab); }, [initialTab, open]);

  const applyAuth = (payload: AuthResponse) => {
    const user = payload?.user;
    if (!payload?.token || !user?.id) {
      throw new Error('登录响应无效，请重试');
    }
    const normalizedUser: ChatUser = {
      id: user.id,
      username: user.username ?? '',
      displayName: user.displayName || user.username || '用户',
      avatar: user.avatar,
    };
    const normalizedPayload = { token: payload.token, user: normalizedUser };
    setSession(normalizedPayload);
    setInitialState((state) => ({ ...state, currentUser: toCurrentUser(normalizedUser) }));
    onClose();
  };

  const submit = async (endpoint: 'login' | 'register') => {
    const form = endpoint === 'login' ? loginForm : registerForm;
    const values = await form.validateFields();
    if (endpoint === 'register' && values.password !== values.confirm) {
      message.error('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/auth/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint === 'login'
          ? { username: values.username, password: values.password }
          : { username: values.username, password: values.password, displayName: values.displayName }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(toErrorMessage(body));
      applyAuth(parseAuthResponse(body));
    } catch (error) {
      message.error(error instanceof Error ? error.message : endpoint === 'login' ? '登录失败' : '注册失败');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal title="账号登录" open={open} onCancel={onClose}
      onOk={() => void submit(activeTab)} confirmLoading={submitting}
      okText={activeTab === 'login' ? '登录' : '注册并登录'} destroyOnHidden>
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as 'login' | 'register')} items={[
        { key: 'login', label: '登录', children: <Form form={loginForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input prefix={<UserOutlined />} /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
        </Form> },
        { key: 'register', label: '注册', children: <Form form={registerForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input prefix={<UserOutlined />} placeholder="至少 3 位，字母、数字、._-" /></Form.Item>
          <Form.Item name="displayName" label="昵称"><Input placeholder="选填，默认为用户名" /></Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" /></Form.Item>
          <Form.Item name="confirm" label="确认密码" rules={[{ required: true, message: '请再次输入密码' }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
        </Form> },
      ]} />
    </Modal>
  );
};

const toCurrentUser = (user: ChatUser) => ({ name: user.displayName, userid: user.id, access: 'user' as const });
