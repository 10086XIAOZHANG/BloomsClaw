// src/pages/chatbot/style.ts
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  pageContainer: css`
    :global(.ant-pro-page-container-children-container) {
      padding: 0 !important;
    }
  `,

  layout: css`
    display: flex;
    flex: 1;
    overflow: hidden;
    min-width: 0;
  `,

  sidebar: css`
    background: ${token.colorBgContainer};
    border-right: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,

  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: ${token.colorBgContainer};
  `,

  workspace: css`
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,

  workspaceInner: css`
    flex: 1;
    min-height: 0;
    padding: ${token.paddingMD}px;
    display: flex;
    flex-direction: column;
    gap: ${token.paddingSM}px;
  `,

  workspaceToolbar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${token.paddingSM}px;
  `,

  workspaceFolder: css`
    flex: 1;
    min-height: 0;
    border-radius: ${token.borderRadiusLG}px;
    overflow: hidden;
    box-shadow: ${token.boxShadowTertiary};
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgElevated};
  `,

  messages: css`
    flex: 1;
    overflow: hidden;
    padding: ${token.paddingMD}px;
    display: flex;
    flex-direction: column;
    align-items: center;

    > * {
      width: 100%;
    }
  `,

  footer: css`
    padding: ${token.paddingMD}px;
    border-top: 1px solid ${token.colorBorderSecondary};
    display: flex;
    justify-content: center;
  `,

  footerCenter: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: ${token.paddingLG}px;
    gap: 28px;
  `,

  composerStack: css`
    width: 100%;
    max-width: 940px;
    display: flex;
    flex-direction: column;
    gap: ${token.paddingSM}px;
  `,

  selectorsCard: css`
    width: 100%;
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: linear-gradient(
      180deg,
      ${token.colorBgElevated} 0%,
      ${token.colorFillAlter} 100%
    );
    box-shadow: ${token.boxShadowTertiary};
  `,

  selectorGrid: css`
    display: flex;
    gap: ${token.paddingMD}px;
    align-items: flex-start;
    flex-wrap: wrap;
  `,

  selectorField: css`
    min-width: 220px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,

  selectorLabel: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    line-height: 1.4;
  `,

  senderShell: css`
    width: 100%;
  `,

  senderRow: css`
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: ${token.paddingSM}px;
  `,

  attachmentRail: css`
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: ${token.paddingXS}px;
    flex: 0 0 auto;
  `,

  senderPanel: css`
    flex: 1;
    min-width: 0;
    border-radius: ${token.borderRadiusLG}px;
    overflow: hidden;
    box-shadow: ${token.boxShadowTertiary};
  `,

  attachmentPreview: css`
    margin: 0;
    padding: ${token.paddingXS}px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillAlter};
  `,

  attachmentTrigger: css`
    width: 40px;
    height: 40px;
    border-radius: ${token.borderRadiusLG}px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowSecondary};
  `,

  thoughtChainWrap: css`
    margin-bottom: ${token.marginXS}px;
    padding: ${token.paddingXS}px ${token.paddingSM}px;
    width: min(720px, 100%);
    box-sizing: border-box;
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillAlter};
    border: 1px solid ${token.colorBorderSecondary};
  `,

  resizeHandle: css`
    width: 8px;
    flex: 0 0 8px;
    cursor: col-resize;
    position: relative;
    background: transparent;

    &::before {
      content: '';
      position: absolute;
      inset: 0 2px;
      border-radius: 999px;
      background: ${token.colorBorderSecondary};
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    &:hover::before {
      opacity: 1;
    }
  `,

  welcomeTitle: css`
    font-size: 32px;
    font-weight: 600;
    color: ${token.colorText};
    text-align: center;
  `,

  cursor: css`
    animation: chatbot-blink 0.8s step-end infinite;

    @keyframes chatbot-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `,
}));
