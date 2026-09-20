// src/pages/chatbot/style.ts — 豆包 doubao.com/chat 风格
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css }) => ({
  pageContainer: css`
    background: #f7f7f8;
    color: #1d1d1f;
    color-scheme: light;
    isolation: isolate;
    :global(.ant-pro-page-container-children-container) {
      padding: 0 !important;
    }
    :global(.ant-page-header) {
      display: none;
    }
    /* 彻底隔离全局深色主题：强制浅底深字 */
    :global(.ant-input),
    :global(.ant-input-affix-wrapper input),
    :global(.ant-select-selection-item),
    :global(.ant-select-selection-placeholder),
    :global(.ant-btn),
    :global(.ant-typography),
    :global(.ant-conversations-item),
    :global(.ant-bubble-content),
    :global(.ant-sender-textarea) {
      color: #1d1d1f;
    }
    :global(.ant-input::placeholder),
    :global(.ant-sender-textarea::placeholder) {
      color: #8e8e93 !important;
      opacity: 1 !important;
    }
    :global(.ant-select-selection-placeholder) {
      color: #8e8e93 !important;
      opacity: 1 !important;
    }
    :global(.ant-empty-description) {
      color: #71717a !important;
    }
  `,

  layout: css`
    display: flex;
    flex: 1;
    min-height: 0;
    height: 100vh;
    background: #f7f7f8;
    color: #1d1d1f;
    overflow: hidden;
  `,

  sidebar: css`
    width: 280px;
    background: #fff;
    color: #1d1d1f;
    border-right: 1px solid #ececee;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px 12px 10px;
    flex-shrink: 0;
  `,
  sideHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 2px 12px;
  `,
  logo: css`
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: linear-gradient(135deg, #4d6bfe 0%, #8a9bff 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 17px;
    flex-shrink: 0;
  `,
  appName: css`
    font-size: 15px;
    font-weight: 700;
    color: #1d1d1f;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  newChatBtn: css`
    height: 36px;
    border-radius: 18px;
    background: #1d1d1f;
    border: none;
    font-size: 14px;
    box-shadow: none;
    flex-shrink: 0;
    color: #fff !important;
    :global(.ant-btn-icon),
    :global(span:not(.ant-btn-icon)) {
      color: #fff !important;
    }
    &:hover {
      background: #000 !important;
      color: #fff !important;
      border: none !important;
    }
  `,
  navMenu: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid #f1f1f3;
  `,
  navItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: none;
    background: transparent;
    border-radius: 10px;
    padding: 9px 10px;
    font-size: 13.5px;
    font-weight: 500;
    color: #1d1d1f;
    cursor: pointer;
    text-align: left;
    line-height: 1.5;
    transition: background 0.15s ease;
    .anticon:first-child {
      font-size: 16px;
      color: #52525b;
    }
    &:hover {
      background: #f4f4f5;
    }
  `,
  navArrow: css`
    margin-left: auto;
    font-size: 12px;
    color: #a1a1aa;
  `,
  searchInput: css`
    margin-bottom: 6px;
    .ant-input-affix-wrapper {
      border-radius: 10px;
      background: #f4f4f5;
      border: none;
      height: 34px;
      box-shadow: none;
      &:focus-within {
        background: #efeff1;
      }
      .ant-input {
        background: transparent;
        font-size: 13px;
      }
    }
  `,
  convList: css`
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -4px;
    padding: 0 4px;
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #e4e4e7;
      border-radius: 3px;
    }
    .ant-conversations-list {
      padding: 0;
    }
    .ant-conversations-group-title {
      font-size: 12px !important;
      color: #a1a1aa !important;
      font-weight: 500;
      padding: 14px 8px 6px !important;
    }
    .ant-conversations-item {
      border-radius: 10px !important;
      padding: 9px 10px !important;
      font-size: 13.5px !important;
      color: #3f3f46 !important;
      line-height: 1.5;
      border: none !important;
      &:hover {
        background: #f4f4f5 !important;
      }
    }
    .ant-conversations-item-active {
      background: #ececf1 !important;
      color: #18181b !important;
      font-weight: 500;
    }
  `,
  sideFooter: css`
    border-top: 1px solid #f1f1f3;
    padding-top: 10px;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  agentRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f7f7f8;
    border-radius: 10px;
    padding: 6px 8px;
    .ant-select {
      flex: 1;
    }
    .ant-select-selector {
      border: none !important;
      background: transparent !important;
      box-shadow: none !important;
      font-size: 13px !important;
      padding: 0 !important;
    }
  `,
  agentAvatar: css`
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #eef0ff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    flex-shrink: 0;
  `,

  resizeHandle: css`
    width: 6px;
    flex: 0 0 6px;
    cursor: col-resize;
    background: transparent;
    &:hover {
      background: #e4e4e7;
    }
  `,

  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: #f7f7f8;
    color: #1d1d1f;
    position: relative;
  `,
  topbar: css`
    height: 52px;
    flex: 0 0 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 0 16px;
    background: #f7f7f8;
    color: #1d1d1f;
  `,
  modelSwitch: css`
    .ant-select-selector {
      border: none !important;
      background: transparent !important;
      box-shadow: none !important;
      font-size: 15px !important;
      font-weight: 600 !important;
      color: #1d1d1f !important;
      padding: 0 4px !important;
    }
    .ant-select-arrow {
      color: #71717a;
      font-size: 11px;
    }
  `,
  topActions: css`
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 4px;
  `,
  topIconBtn: css`
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: #52525b;
    &:hover {
      background: #ececee !important;
      color: #18181b !important;
    }
  `,

  messages: css`
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 16px 8px;
    background: #f7f7f8;
    color: #1d1d1f;
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #d4d4d8;
      border-radius: 3px;
    }
    > * {
      width: 100%;
      max-width: 768px;
    }
    .ant-bubble-list {
      max-width: 768px;
      margin: 0 auto;
      gap: 20px;
      color: #1d1d1f;
    }
    .ant-bubble-avatar {
      margin-top: 2px;
    }
    .ant-bubble-content {
      color: #1d1d1f !important;
      font-size: 14.5px;
      line-height: 1.75;
    }
    .ant-bubble-content-filled {
      background: #ececf1 !important;
      border-radius: 4px 16px 16px 16px;
      color: #1d1d1f !important;
      font-size: 14.5px;
      line-height: 1.75;
      padding: 10px 14px;
      box-shadow: none;
    }
    .ant-bubble-content .ant-bubble-typing {
      background: transparent;
    }
    /* markdown 内容强制深色 */
    .ant-bubble-content p,
    .ant-bubble-content li,
    .ant-bubble-content span,
    .ant-bubble-content div,
    .ant-bubble-content h1,
    .ant-bubble-content h2,
    .ant-bubble-content h3,
    .ant-bubble-content h4,
    .ant-bubble-content code {
      color: #1d1d1f !important;
    }
    .ant-bubble-content pre {
      background: #fff !important;
      border: 1px solid #ececee !important;
    }
    .ant-bubble-content pre code {
      background: transparent !important;
    }
  `,

  welcomeWrap: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 768px;
    margin: 0 auto;
    padding: 24px 16px 12px;
    gap: 0;
  `,
  welcomeTitle: css`
    font-size: 30px;
    font-weight: 700;
    color: #1d1d1f;
    letter-spacing: -0.02em;
    text-align: center;
    line-height: 1.3;
    margin-bottom: 6px;
  `,
  welcomeSub: css`
    font-size: 14px;
    color: #71717a;
    text-align: center;
    margin-bottom: 22px;
  `,
  suggestGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    width: 100%;
    margin-bottom: 22px;
    @media (max-width: 640px) {
      grid-template-columns: 1fr;
    }
  `,
  suggestCard: css`
    background: #fff;
    border: 1px solid #ececee;
    border-radius: 14px;
    padding: 13px 14px;
    cursor: pointer;
    text-align: left;
    transition: all 0.18s ease;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    &:hover {
      border-color: #d4d4d8;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
      transform: translateY(-1px);
    }
  `,
  suggestIcon: css`
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  `,
  suggestTitle: css`
    font-size: 13.5px;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 2px;
  `,
  suggestDesc: css`
    font-size: 12.5px;
    color: #71717a;
    line-height: 1.5;
  `,
  cursor: css`
    animation: chatbot-blink 0.8s step-end infinite;
    @keyframes chatbot-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `,

  footer: css`
    padding: 8px 16px 14px;
    display: flex;
    justify-content: center;
    background: linear-gradient(180deg, rgba(247, 247, 248, 0) 0%, #f7f7f8 28%);
  `,
  composerStack: css`
    width: 100%;
    max-width: 768px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  composerBox: css`
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 24px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.07);
    overflow: hidden;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
    &:focus-within {
      border-color: #c7c9d1;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
    }
    .ant-sender {
      border: none !important;
      box-shadow: none !important;
      background: #fff !important;
      border-radius: 24px !important;
      color: #1d1d1f !important;
    }
    .ant-sender-content {
      padding: 12px 16px 4px !important;
      background: #fff !important;
    }
    .ant-sender-textarea {
      font-size: 14.5px !important;
      line-height: 1.6 !important;
      color: #1d1d1f !important;
      background: transparent !important;
    }
    .ant-sender-textarea::placeholder {
      color: #8e8e93 !important;
      opacity: 1 !important;
    }
    .ant-sender-actions {
      padding: 4px 10px 10px !important;
      background: #fff !important;
    }
    .ant-sender-send-btn {
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
      background: #1d1d1f !important;
      border: none !important;
      &:hover {
        background: #000 !important;
      }
      &:disabled {
        background: #e4e4e7 !important;
        color: #a1a1aa !important;
      }
    }
  `,
  composerToolbar: css`
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px 10px 12px;
  `,
  toolBtn: css`
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: #52525b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    &:hover {
      background: #f4f4f5 !important;
      color: #18181b !important;
    }
  `,
  composerHint: css`
    text-align: center;
    font-size: 12px;
    color: #a1a1aa;
  `,
  attachmentPreview: css`
    margin: 0;
    padding: 8px 12px 0;
    background: transparent;
    border: none;
  `,
  attachmentTrigger: css`
    border: none;
    box-shadow: none;
    background: transparent;
  `,

  thoughtChainWrap: css`
    margin-bottom: 6px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    border-radius: 12px;
    background: #fff;
    border: 1px solid #ececee;
    padding: 4px 10px;
    font-size: 13px;
    color: #52525b;
  `,

  workspace: css`
    background: #fff;
    border-left: 1px solid #ececee;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  `,
  workspaceInner: css`
    flex: 1;
    min-height: 0;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  workspaceToolbar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  `,
  workspaceFolder: css`
    flex: 1;
    min-height: 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #ececee;
    background: #fafafa;
  `,
  senderShell: css`
    width: 100%;
  `,
}));
