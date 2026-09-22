import { UserOutlined } from '@ant-design/icons';
import { useModel } from '@umijs/max';
import { Avatar } from 'antd';
import React, { useState } from 'react';
import { AvatarDropdown } from '@/components/RightContent/AvatarDropdown';
import { UserAuthModal } from '@/components/UserAuthModal';

/**
 * 全局左侧菜单底部的用户标识（Doubao 风格）。
 * - 已登录：头像 + 昵称（可点击切换账号 / 退出登录）。
 * - 未登录：显示「未登录」，点击打开登录弹窗。
 * 通过 ProLayout 的 menuFooterRender 挂载，覆盖配置管理等使用全局侧边栏的页面。
 */
const MenuFooterUser: React.FC<{ collapsed?: boolean }> = ({ collapsed }) => {
  const { initialState } = useModel('@@initialState');
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const currentUserName = initialState?.currentUser?.name || '未登录';

  return (
    <>
      <AvatarDropdown
        menu={false}
        onUnauthenticatedClick={() => {
          setAuthTab('login');
          setAuthOpen(true);
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 9,
            padding: collapsed ? '8px' : '8px 10px',
            margin: 8,
            borderRadius: 10,
            cursor: 'pointer',
            background: '#f7f7f8',
          }}
        >
          <Avatar
            size={28}
            icon={<UserOutlined />}
            style={{
              flexShrink: 0,
              background:
                currentUserName !== '未登录' ? '#4d6bfe' : '#1d1d1f',
              color: '#fff',
            }}
          >
            {currentUserName !== '未登录' ? currentUserName.slice(0, 1) : undefined}
          </Avatar>
          {!collapsed && (
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                color: '#3f3f46',
              }}
            >
              {currentUserName}
            </span>
          )}
        </div>
      </AvatarDropdown>
      <UserAuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        initialTab={authTab}
      />
    </>
  );
};

export default MenuFooterUser;