import {
  LogoutOutlined,
  SettingOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import { createStyles } from 'antd-style';
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { clearSession, getStoredUser } from '@/utils/userSession';
import HeaderDropdown from '../HeaderDropdown';
import { UserAuthModal } from '../UserAuthModal';

export type GlobalHeaderRightProps = {
  menu?: boolean;
  children?: React.ReactNode;
  onUnauthenticatedClick?: () => void;
};

export const AvatarName = () => {
  const { initialState } = useModel('@@initialState');
  const { currentUser } = initialState || {};
  return <span className="anticon">{currentUser?.name}</span>;
};

const useStyles = createStyles(({ token }) => {
  return {
    action: {
      display: 'flex',
      height: '48px',
      marginLeft: 'auto',
      overflow: 'hidden',
      alignItems: 'center',
      padding: '0 8px',
      cursor: 'pointer',
      borderRadius: token.borderRadius,
      '&:hover': {
        backgroundColor: token.colorBgTextHover,
      },
    },
  };
});

export const AvatarDropdown: React.FC<GlobalHeaderRightProps> = ({
  menu,
  children,
  onUnauthenticatedClick,
}) => {
  const [authOpen, setAuthOpen] = useState(false);
  const { styles } = useStyles();
  const { initialState, setInitialState } = useModel('@@initialState');

  /**
   * 退出登录：清空本地会话后整体刷新，
   * 使会话列表、工作区等按默认用户重新加载（无登录仍可用）。
   */
  const logout = () => {
    flushSync(() => {
      setInitialState((s) => ({ ...s, currentUser: undefined }));
    });
    clearSession();
    window.location.reload();
  };

  const onMenuClick: MenuProps['onClick'] = (event) => {
    const { key } = event;
    if (key === 'logout') {
      logout();
      return;
    }
    if (key === 'switch') {
      setAuthOpen(true);
      return;
    }
    history.push(`/account/${key}`);
  };

  const loading = (
    <span className={styles.action}>
      <Spin
        size="small"
        style={{
          marginLeft: 8,
          marginRight: 8,
        }}
      />
    </span>
  );

  if (!initialState) {
    return loading;
  }

  const { currentUser } = initialState;

  if (!currentUser?.name) {
    return loading;
  }

  const isAuthenticated = Boolean(getStoredUser());
  const menuItems = isAuthenticated
    ? [
        ...(menu
          ? [
              {
                key: 'center',
                icon: <UserOutlined />,
                label: '个人中心',
              },
              {
                key: 'settings',
                icon: <SettingOutlined />,
                label: '个人设置',
              },
              {
                type: 'divider' as const,
              },
            ]
          : []),
        {
          key: 'switch',
          icon: <SwapOutlined />,
          label: '切换账号',
        },
        {
          key: 'logout',
          icon: <LogoutOutlined />,
          label: '退出登录',
        },
      ]
    : [];

  return (
    <>
      {isAuthenticated ? (
        <HeaderDropdown
          menu={{
            selectedKeys: [],
            onClick: onMenuClick,
            items: menuItems,
          }}
        >
          {children}
        </HeaderDropdown>
      ) : (
        <span
          onClick={onUnauthenticatedClick}
          style={onUnauthenticatedClick ? { cursor: 'pointer' } : undefined}
        >
          {children}
        </span>
      )}
      <UserAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
};
