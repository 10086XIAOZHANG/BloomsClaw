import {
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Attachments, Bubble, Conversations, FileCard, Folder, Sender, ThoughtChain, XProvider } from '@ant-design/x';
import type { BubbleItemType, BubbleListProps, FileCardProps, ThoughtChainItemType } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import { App, Avatar, Button, Card, Select, Space, Tag, Typography } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import type { UploadRequestOption as RcCustomRequestOptions } from 'rc-upload/lib/interface';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ChatAgentOption,
  ChatAttachment,
  ChatMessage,
  ChatThoughtStep,
  ConversationItem,
} from './data';
import {
  deleteChatHistory,
  getWorkspaceFileContent,
  getWorkspaceTree,
  listSelectableAgents,
  listChatHistory,
  streamChatCompletion,
  uploadChatAttachments,
  type WorkspaceTreeNode,
} from './service';
import { useStyles } from './style';

const WELCOME_TEXT = '🤖 你好，有什么可以帮你？';
const CHATBOT_CONVERSATION_AGENT_STORAGE_KEY =
  'blooms_claw.chatbot.conversation_agents';
const CHATBOT_CONVERSATION_ID_QUERY_KEY = 'conversationId';
const CHATBOT_PANEL_LAYOUT_STORAGE_KEY = 'blooms_claw.chatbot.panel_layout';

type ConversationAgentMap = Record<string, string>;
type ThoughtChainExpandedMap = Record<string, string[]>;
type PanelResizeTarget = 'left' | 'right';
type ChatPanelLayout = {
  leftWidth: number;
  rightWidth: number;
};
type AttachmentItem = UploadFile<ChatAttachment> & {
  response?: ChatAttachment;
  description?: React.ReactNode;
  originFileObj?: RcFile;
};

const DEFAULT_PANEL_LAYOUT: ChatPanelLayout = {
  leftWidth: 260,
  rightWidth: 360,
};
const MIN_LEFT_PANEL_WIDTH = 220;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MIN_MAIN_PANEL_WIDTH = 560;

const readConversationAgentMap = (): ConversationAgentMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(
      CHATBOT_CONVERSATION_AGENT_STORAGE_KEY,
    );
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};

const writeConversationAgentMap = (conversationAgentMap: ConversationAgentMap) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    CHATBOT_CONVERSATION_AGENT_STORAGE_KEY,
    JSON.stringify(conversationAgentMap),
  );
};

const readChatPanelLayout = (): ChatPanelLayout => {
  if (typeof window === 'undefined') {
    return DEFAULT_PANEL_LAYOUT;
  }

  try {
    const rawValue = window.localStorage.getItem(CHATBOT_PANEL_LAYOUT_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_PANEL_LAYOUT;
    }

    const parsed = JSON.parse(rawValue) as Partial<ChatPanelLayout>;
    const leftWidth = Number(parsed.leftWidth);
    const rightWidth = Number(parsed.rightWidth);

    return {
      leftWidth: Number.isFinite(leftWidth) ? leftWidth : DEFAULT_PANEL_LAYOUT.leftWidth,
      rightWidth: Number.isFinite(rightWidth) ? rightWidth : DEFAULT_PANEL_LAYOUT.rightWidth,
    };
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
};

const writeChatPanelLayout = (panelLayout: ChatPanelLayout) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    CHATBOT_PANEL_LAYOUT_STORAGE_KEY,
    JSON.stringify(panelLayout),
  );
};

const readConversationIdFromUrl = (): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const params = new URLSearchParams(window.location.search);
  const conversationId = params.get(CHATBOT_CONVERSATION_ID_QUERY_KEY)?.trim();
  return conversationId || undefined;
};

const writeConversationIdToUrl = (conversationId: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set(CHATBOT_CONVERSATION_ID_QUERY_KEY, conversationId);
  window.history.replaceState({}, '', url.toString());
};

const TypewriterTitle: React.FC = () => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= WELCOME_TEXT.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= WELCOME_TEXT.length) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {WELCOME_TEXT.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

const THINK_TAG_PATTERN = /<\/?think>/gi;
const THINK_TAG_PREFIX_PATTERN = /<(?:\/)?t(?:h(?:i(?:n(?:k?)?)?)?)?$/i;
const STREAMING_TEXT_STYLE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const AI_AVATAR_STYLE: React.CSSProperties = {
  background: 'transparent',
  fontSize: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '-2px',
};

const sanitizeThinkText = (content: string): string =>
  content
    .replace(THINK_TAG_PATTERN, '')
    .replace(THINK_TAG_PREFIX_PATTERN, '');

const aiAvatarNode = <Avatar style={AI_AVATAR_STYLE}>🤖</Avatar>;
const DRAFT_CONVERSATION_LABEL = '💬 新对话';

const createDraftConversation = (): ConversationItem => ({
  key: crypto.randomUUID(),
  label: DRAFT_CONVERSATION_LABEL,
  group: '今天',
  isDraft: true,
});

const createInitialChatState = () => {
  const draftConversation = createDraftConversation();
  return {
    conversations: [draftConversation],
    messageMap: { [draftConversation.key]: [] as ChatMessage[] },
    activeKey: draftConversation.key,
  };
};

const WORKSPACE_ROOT = '/Users/jack/.blooms_claw/workspaces';

const toWorkspaceFilePath = (pathSegments: string[]): string =>
  pathSegments.filter(Boolean).join('/');

const getConversationGroup = (updatedAt: string): string => {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return '更早';
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfTargetDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays =
    (startOfToday.getTime() - startOfTargetDay.getTime()) / (24 * 60 * 60 * 1000);

  if (diffDays <= 0) {
    return '今天';
  }
  if (diffDays === 1) {
    return '昨天';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
};

const formatAttachmentSize = (size?: number): string => {
  if (!size) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getAttachmentIcon = (attachment: Pick<ChatAttachment, 'kind'>) => {
  if (attachment.kind === 'image') {
    return <FileImageOutlined />;
  }
  if (attachment.kind === 'spreadsheet') {
    return <FileExcelOutlined />;
  }
  if (attachment.kind === 'document' || attachment.kind === 'text') {
    return <FileTextOutlined />;
  }

  return <FileOutlined />;
};

const resolveFileCardIcon = (
  name: string,
  kind: ChatAttachment['kind'],
): FileCardProps['icon'] => {
  const extension = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    : '';

  if (kind === 'image') return 'image';
  if (kind === 'spreadsheet') return 'excel';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'doc' || extension === 'docx' || kind === 'document') return 'word';
  if (extension === 'ppt' || extension === 'pptx') return 'ppt';
  if (extension === 'md' || extension === 'mdx') return 'markdown';
  if (extension === 'zip' || extension === 'rar' || extension === '7z' || extension === 'tar' || extension === 'gz') return 'zip';
  if (extension === 'mp4' || extension === 'mov' || extension === 'webm') return 'video';
  if (extension === 'mp3' || extension === 'wav' || extension === 'aac') return 'audio';
  if (extension === 'java') return 'java';
  if (extension === 'js' || extension === 'jsx' || extension === 'ts' || extension === 'tsx') return 'javascript';
  if (extension === 'py') return 'python';
  return getAttachmentIcon({ kind });
};

const resolveFileCardType = (
  name: string,
  kind: ChatAttachment['kind'],
): FileCardProps['type'] => {
  const extension = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    : '';

  if (kind === 'image') return 'image';
  if (['mp4', 'mov', 'webm'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'aac'].includes(extension)) return 'audio';
  return 'file';
};

const toFileCardProps = (
  attachment: ChatAttachment,
  options?: {
    src?: string;
    loading?: boolean;
    description?: React.ReactNode;
  },
): FileCardProps => {
  const { name, size, kind, token } = attachment;
  return {
    key: token,
    name,
    byte: size,
    type: resolveFileCardType(name, kind),
    icon: resolveFileCardIcon(name, kind),
    src: options?.src,
    loading: options?.loading,
    description:
      options?.description ??
      ((info) => (
        <Space size={4} split={<span style={{ opacity: 0.4 }}>·</span>}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {info.size}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {kind}
          </Typography.Text>
        </Space>
      )),
  };
};

const getAttachmentPreviewUrl = (
  item: AttachmentItem | UploadFile | undefined,
): string | undefined => {
  if (!item) return undefined;
  const typedItem = item as {
    url?: string;
    thumbUrl?: string;
    preview?: string;
    originFileObj?: Blob;
    response?: ChatAttachment;
  };
  if (typedItem.thumbUrl) return typedItem.thumbUrl;
  if (typedItem.preview) return typedItem.preview;
  if (typedItem.url) return typedItem.url;
  if (typedItem.originFileObj) {
    if (typeof window === 'undefined' || !('URL' in window)) return undefined;
    try {
      return window.URL.createObjectURL(typedItem.originFileObj);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const renderMessageAttachments = (
  attachments: ChatAttachment[] | undefined,
): React.ReactNode => {
  if (!attachments?.length) {
    return undefined;
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <FileCard.List
        size="small"
        overflow="wrap"
        items={attachments.map((attachment) =>
          toFileCardProps(attachment, {
            src:
              attachment.kind === 'image'
                ? attachment.url ?? undefined
                : attachment.url,
          }),
        )}
      />
    </div>
  );
};

const toRestoredChatMessage = (
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: ChatAttachment[];
    rawThinkContent?: string;
    thoughtSteps?: ChatThoughtStep[];
    status?: 'updating' | 'done' | 'error';
  },
): ChatMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  attachments: message.attachments,
  rawThinkContent: message.rawThinkContent,
  thinkContent: message.rawThinkContent
    ? sanitizeThinkText(message.rawThinkContent)
    : undefined,
  thoughtSteps:
    message.thoughtSteps && message.thoughtSteps.length > 0
      ? message.thoughtSteps.map((step) => ({
          ...step,
          content:
            step.key.includes('reasoning') && step.content
              ? sanitizeThinkText(step.content)
              : step.content,
        }))
      : message.rawThinkContent
        ? [
            {
              key: REASONING_STEP_KEY,
              title: '深度思考',
              description: '历史会话中的思考过程',
              content: sanitizeThinkText(message.rawThinkContent),
              status: 'success',
            },
          ]
        : undefined,
  isThinking:
    message.status === 'updating'
    || Boolean(message.thoughtSteps?.some((step) => step.status === 'loading')),
  status:
    message.status === 'error'
      ? 'error'
      : message.status === 'updating'
        ? 'updating'
        : 'done',
});

const renderMarkdownContent = (
  content: string,
  isStreaming: boolean,
): React.ReactNode => {
  if (isStreaming) {
    return <div style={STREAMING_TEXT_STYLE}>{content}</div>;
  }

  return <XMarkdown>{content}</XMarkdown>;
};

const StreamingThinkContent: React.FC<{
  content: string;
  isStreaming: boolean;
}> = ({ content, isStreaming }) => {
  return <>{renderMarkdownContent(content, isStreaming)}</>;
};

const REASONING_STEP_KEY = 'reasoning';
const THOUGHT_CHAIN_STYLES = {
  root: { width: '100%' },
  itemContent: { marginTop: 8 },
};

const getReasoningStepKey = (
  steps: ChatThoughtStep[] | undefined,
): string =>
  steps?.find((step) => step.key === REASONING_STEP_KEY || step.key.includes('reasoning'))
    ?.key ?? REASONING_STEP_KEY;

const renderThoughtStepContent = (
  step: ChatThoughtStep,
  isStreaming: boolean,
): React.ReactNode => {
  if (!step.content) {
    return undefined;
  }

  return (
    <StreamingThinkContent
      content={step.content}
      isStreaming={isStreaming && step.key.includes('reasoning')}
    />
  );
};

const upsertThoughtStep = (
  steps: ChatThoughtStep[] | undefined,
  nextStep: ChatThoughtStep,
): ChatThoughtStep[] => {
  const currentSteps = steps ?? [];
  const targetIndex = currentSteps.findIndex((item) => item.key === nextStep.key);

  if (targetIndex === -1) {
    return [...currentSteps, nextStep];
  }

  return currentSteps.map((item, index) =>
    index === targetIndex
      ? {
          ...item,
          ...nextStep,
          content: nextStep.content ?? item.content,
          description: nextStep.description ?? item.description,
        }
      : item,
  );
};

const finalizeThoughtSteps = (
  steps: ChatThoughtStep[] | undefined,
  loadingStatus: ChatThoughtStep['status'],
): ChatThoughtStep[] | undefined =>
  steps?.map((step) =>
    step.status === 'loading'
      ? {
          ...step,
          status: loadingStatus,
        }
      : step,
  );

const toThoughtChainItems = (
  steps: ChatThoughtStep[] | undefined,
  isStreaming: boolean,
): ThoughtChainItemType[] =>
  (steps ?? []).map((step) => ({
    key: step.key,
    title: step.title,
    description: step.description,
    content: renderThoughtStepContent(step, isStreaming),
    status: step.status,
    collapsible: Boolean(step.content),
    blink: isStreaming && step.status === 'loading',
  }));

const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    avatar: <Avatar icon={<UserOutlined />} />,
  },
  ai: {
    placement: 'start',
    avatar: aiAvatarNode,
    typing: { effect: 'typing', step: 2, interval: 20 },
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return renderMarkdownContent(content, info?.status === 'updating');
    },
  },
};

const ChatbotPage: React.FC = () => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const initialChatStateRef = useRef(createInitialChatState());
  const initialChatState = initialChatStateRef.current;

  const [conversations, setConversations] = useState<ConversationItem[]>(
    initialChatState.conversations,
  );
  const [messageMap, setMessageMap] = useState<Record<string, ChatMessage[]>>(
    initialChatState.messageMap,
  );
  const [activeKey, setActiveKey] = useState<string>(initialChatState.activeKey);
  const [inputValue, setInputValue] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [agentOptions, setAgentOptions] = useState<ChatAgentOption[]>([]);
  const [conversationAgentMap, setConversationAgentMap] =
    useState<ConversationAgentMap>(readConversationAgentMap);
  const [thoughtChainExpandedMap, setThoughtChainExpandedMap] =
    useState<ThoughtChainExpandedMap>({});
  const [hasResolvedInitialConversation, setHasResolvedInitialConversation] =
    useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{
    target: PanelResizeTarget;
    startX: number;
    startLeftWidth: number;
    startRightWidth: number;
  } | null>(null);
  const attachmentsRef = useRef<{ select: (options?: { accept?: string; multiple?: boolean }) => void; upload: (file: File) => void } | null>(null);
  const senderShellRef = useRef<HTMLDivElement | null>(null);
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([]);
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeNode[]>([]);
  const [workspaceExpandedPaths, setWorkspaceExpandedPaths] = useState<string[]>([]);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string[]>();
  const [panelLayout, setPanelLayout] = useState<ChatPanelLayout>(readChatPanelLayout);
  const activeMessages = messageMap[activeKey] ?? [];
  const selectedAgentName = useMemo(() => {
    const storedAgentName = conversationAgentMap[activeKey];
    if (storedAgentName && agentOptions.some((item) => item.value === storedAgentName)) {
      return storedAgentName;
    }

    return agentOptions[0]?.value;
  }, [activeKey, agentOptions, conversationAgentMap]);
  const uploadedAttachments = useMemo(
    () =>
      attachmentItems.flatMap((item) =>
        item.status === 'done' && item.response ? [item.response] : [],
      ),
    [attachmentItems],
  );
  const workspaceFileContentService = useMemo(
    () => ({
      loadFileContent: async (filePath: string) => getWorkspaceFileContent(filePath),
    }),
    [],
  );
  const refreshWorkspaceTree = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        const workspace = await getWorkspaceTree();
        setWorkspaceTree(workspace.treeData);
        setWorkspaceExpandedPaths((previousPaths) =>
          previousPaths.length > 0
            ? previousPaths
            : workspace.treeData
                .filter((item) => Array.isArray(item.children) && item.children.length > 0)
                .map((item) => item.path),
        );
      } catch (error) {
        console.error('加载工作区文件树失败', error);
        if (!options?.silent) {
          message.error('加载工作区文件树失败');
        }
      }
    },
    [message],
  );

  const normalizeAttachmentItem = (item: AttachmentItem): AttachmentItem => {
    const attachment = item.response;
    return {
      ...item,
      description:
        attachment
          ? [formatAttachmentSize(attachment.size), attachment.kind]
              .filter(Boolean)
              .join(' · ')
          : item.status === 'uploading'
            ? '上传中...'
            : item.status === 'error'
              ? '上传失败，请移除后重试'
              : '等待上传',
    };
  };

  const handleAttachmentItemsChange = (items: AttachmentItem[]) => {
    setAttachmentItems(items.map((item) => normalizeAttachmentItem(item)));
  };

  const handleAttachmentUpload = (options: {
    file: RcCustomRequestOptions['file'];
    onSuccess?: RcCustomRequestOptions<ChatAttachment>['onSuccess'];
    onError?: RcCustomRequestOptions<ChatAttachment>['onError'];
  }) => {
    void (async () => {
      try {
        const file = options.file as File;
        const [uploadedAttachment] = await uploadChatAttachments([file]);
        options.onSuccess?.(uploadedAttachment);
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error('附件上传失败'));
      }
    })();
  };

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.removeItem('blooms_claw.chatbot.selected_agent');
  }, []);

  useEffect(() => {
    setAttachmentItems([]);
  }, [activeKey]);

  useEffect(() => {
    void refreshWorkspaceTree({ silent: true });
  }, [refreshWorkspaceTree]);

  useEffect(() => {
    writeChatPanelLayout(panelLayout);
  }, [panelLayout]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current;
      const layoutElement = layoutRef.current;
      if (!resizeState || !layoutElement) {
        return;
      }

      const layoutWidth = layoutElement.getBoundingClientRect().width;
      const maxLeftWidth = Math.max(
        MIN_LEFT_PANEL_WIDTH,
        layoutWidth - resizeState.startRightWidth - MIN_MAIN_PANEL_WIDTH,
      );
      const maxRightWidth = Math.max(
        MIN_RIGHT_PANEL_WIDTH,
        layoutWidth - resizeState.startLeftWidth - MIN_MAIN_PANEL_WIDTH,
      );

      if (resizeState.target === 'left') {
        const nextLeftWidth = Math.min(
          Math.max(
            resizeState.startLeftWidth + (event.clientX - resizeState.startX),
            MIN_LEFT_PANEL_WIDTH,
          ),
          maxLeftWidth,
        );
        setPanelLayout((previousLayout) => ({
          ...previousLayout,
          leftWidth: nextLeftWidth,
        }));
        return;
      }

      const nextRightWidth = Math.min(
        Math.max(
          resizeState.startRightWidth - (event.clientX - resizeState.startX),
          MIN_RIGHT_PANEL_WIDTH,
        ),
        maxRightWidth,
      );
      setPanelLayout((previousLayout) => ({
        ...previousLayout,
        rightWidth: nextRightWidth,
      }));
    };

    const handleMouseUp = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const historyConversations = await listChatHistory();
        if (cancelled) {
          return;
        }

        if (historyConversations.length === 0) {
          setHasResolvedInitialConversation(true);
          return;
        }

        const nextConversations = historyConversations.map((conversation) => ({
          key: conversation.id,
          label: conversation.label || '新对话',
          group: getConversationGroup(conversation.updatedAt),
          isDraft: false,
        }));
        const nextMessageMap = Object.fromEntries(
          historyConversations.map((conversation) => [
            conversation.id,
            conversation.messages.map((message) =>
              toRestoredChatMessage(message),
            ),
          ]),
        );

        setConversations(nextConversations);
        setMessageMap(nextMessageMap);
        const conversationIdFromUrl = readConversationIdFromUrl();
        setActiveKey((previousActiveKey) => {
          if (conversationIdFromUrl && nextMessageMap[conversationIdFromUrl]) {
            return conversationIdFromUrl;
          }
          return nextMessageMap[previousActiveKey]
            ? previousActiveKey
            : nextConversations[0].key;
        });
        setHasResolvedInitialConversation(true);
      } catch (error) {
        console.error('加载会话历史失败', error);
        if (!cancelled) {
          setHasResolvedInitialConversation(true);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSelections = async () => {
      try {
        const agents = await listSelectableAgents();

        if (cancelled) {
          return;
        }

        const nextAgentOptions = agents
          .filter((item) => item.active === 1)
          .map((item) => ({
            value: item.name,
            label: item.name,
          }));

        setAgentOptions(nextAgentOptions);
      } catch (error) {
        console.error('加载可选 Agents 失败', error);
      }
    };

    void loadSelections();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (agentOptions.length === 0) {
      return;
    }

    setConversationAgentMap((previousMap) => {
      const nextEntries = Object.entries(previousMap).filter(([, agentName]) =>
        agentOptions.some((item) => item.value === agentName),
      );
      const nextMap = Object.fromEntries(nextEntries);
      const isUnchanged =
        Object.keys(previousMap).length === Object.keys(nextMap).length
        && Object.entries(previousMap).every(
          ([key, value]) => nextMap[key] === value,
        );

      if (isUnchanged) {
        return previousMap;
      }

      writeConversationAgentMap(nextMap);
      return nextMap;
    });
  }, [agentOptions]);

  const handleAgentChange = (agentName: string) => {
    setConversationAgentMap((previousMap) => {
      if (previousMap[activeKey] === agentName) {
        return previousMap;
      }

      const nextMap = {
        ...previousMap,
        [activeKey]: agentName,
      };
      writeConversationAgentMap(nextMap);
      return nextMap;
    });
  };

  const handleActiveChange = (nextActiveKey: string) => {
    setActiveKey(nextActiveKey);
  };

  const startResize = (target: PanelResizeTarget) => (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    resizeStateRef.current = {
      target,
      startX: event.clientX,
      startLeftWidth: panelLayout.leftWidth,
      startRightWidth: panelLayout.rightWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    if (!activeKey || !hasResolvedInitialConversation) {
      return;
    }

    writeConversationIdToUrl(activeKey);
  }, [activeKey, hasResolvedInitialConversation]);

  useEffect(() => {
    setThoughtChainExpandedMap((previousMap) => {
      const nextMap: ThoughtChainExpandedMap = {};
      let hasChanged = false;

      for (const message of activeMessages) {
        if (message.role !== 'assistant' || !message.thoughtSteps?.length) {
          continue;
        }

        const messageKey = message.requestId ?? message.id;
        const previousExpandedKeys = previousMap[messageKey];

        if (!previousExpandedKeys) {
          nextMap[messageKey] = [];
          continue;
        }

        const knownStepKeys = new Set(
          message.thoughtSteps.map((step) => String(step.key)),
        );
        const preservedExpandedKeys = previousExpandedKeys.filter((key) =>
          knownStepKeys.has(key),
        );
        const isSameAsPrevious =
          preservedExpandedKeys.length === previousExpandedKeys.length
          && preservedExpandedKeys.every(
            (key, index) => key === previousExpandedKeys[index],
          );

        nextMap[messageKey] = isSameAsPrevious
          ? previousExpandedKeys
          : preservedExpandedKeys;
        if (!isSameAsPrevious) {
          hasChanged = true;
        }
      }

      if (!hasChanged) {
        const previousKeys = Object.keys(previousMap);
        const nextKeys = Object.keys(nextMap);
        if (
          previousKeys.length === nextKeys.length
          && previousKeys.every((key) => nextMap[key] === previousMap[key])
        ) {
          return previousMap;
        }
      }

      return nextMap;
    });
  }, [activeMessages]);

  const sendMessage = async (content: string) => {
    const question = content.trim();
    const hasUploadingAttachment = attachmentItems.some(
      (item) => item.status === 'uploading',
    );
    const hasErroredAttachment = attachmentItems.some(
      (item) => item.status === 'error',
    );
    const hasUploadedAttachment = uploadedAttachments.length > 0;

    if (isRequesting) return;
    if (!question && !hasUploadedAttachment) return;
    if (hasUploadingAttachment) {
      message.warning('附件还在上传中，请稍等一下');
      return;
    }
    if (hasErroredAttachment) {
      message.warning('有附件上传失败，请移除后再发送');
      return;
    }
    if (!selectedAgentName) {
      message.warning('请先在 Agents 配置中启用并选择一个 Agent');
      return;
    }

    const targetKey = activeKey;
    const currentAttachments = uploadedAttachments;
    const targetConversation = conversations.find(
      (conversation) => conversation.key === targetKey,
    );
    const userContent = question || '请阅读并分析我上传的附件内容。';
    setInputValue('');
    setAttachmentItems([]);
    setConversations((prev) =>
      prev.map((c) =>
        c.key === targetKey && c.isDraft
          ? {
              ...c,
              label: (
                question.slice(0, 20)
                || currentAttachments[0]?.name?.slice(0, 20)
                || '新对话'
              ),
              isDraft: false,
            }
          : c,
      ),
    );

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      attachments: currentAttachments,
      status: 'done',
    };
    const assistantRequestId = crypto.randomUUID();

    setMessageMap((prev) => ({
      ...prev,
      [targetKey]: [
        ...(prev[targetKey] ?? []),
        userMessage,
        {
          id: '',
          requestId: assistantRequestId,
          role: 'assistant',
          content: '',
          thoughtSteps: [],
          status: 'updating',
        },
      ],
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    setIsRequesting(true);

    try {
      await streamChatCompletion(userContent, {
        signal: controller.signal,
        id: targetConversation?.key ?? targetKey,
        agentName: selectedAgentName,
        // Skills 改为 agent 端按用户提问渐进式自动加载，前端不再手动预选
        skillNames: [],
        attachments: currentAttachments,
        onChunk: (chunk) => {
          setMessageMap((prev) => ({
            ...prev,
            [targetKey]: (prev[targetKey] ?? []).map((message) =>
              message.requestId === assistantRequestId
                ? {
                    ...message,
                    id: chunk.id || message.id,
                    ...(chunk.type === 'thinking_delta'
                      ? (() => {
                          const rawThinkContent = `${message.rawThinkContent ?? ''}${chunk.delta}`;
                          const thinkContent = sanitizeThinkText(rawThinkContent);
                          const reasoningStepKey = getReasoningStepKey(message.thoughtSteps);
                          return {
                            rawThinkContent,
                            thinkContent,
                            isThinking: true,
                            thoughtSteps: upsertThoughtStep(message.thoughtSteps, {
                              key: reasoningStepKey,
                              title: '深度思考',
                              description: '模型正在分析问题并规划执行步骤',
                              content: thinkContent,
                              status: 'loading',
                            }),
                            status: 'updating' as const,
                          };
                        })()
                      : chunk.type === 'content_delta'
                      ? {
                          content: `${message.content}${chunk.delta}`,
                          isThinking: false,
                          status: 'updating' as const,
                        }
                      : chunk.type === 'thought_step'
                      ? {
                          thoughtSteps: upsertThoughtStep(message.thoughtSteps, {
                            ...chunk.step,
                            content:
                              chunk.step.key === REASONING_STEP_KEY
                                ? chunk.step.content ?? message.thinkContent
                                : chunk.step.content,
                          }),
                        }
                      : chunk.type === 'error'
                      ? {
                          content:
                            message.content ||
                            chunk.error ||
                            '请求失败，请稍后重试。',
                          isThinking: false,
                          thoughtSteps: finalizeThoughtSteps(message.thoughtSteps, 'error'),
                          status: 'error' as const,
                        }
                      : chunk.type === 'done'
                      ? {
                          isThinking: false,
                          thoughtSteps: finalizeThoughtSteps(message.thoughtSteps, 'success'),
                          status: 'done' as const,
                        }
                      : {}),
                  }
                : message,
            ),
          }));
        },
      });

      setMessageMap((prev) => ({
        ...prev,
        [targetKey]: (prev[targetKey] ?? []).map((message) =>
          message.requestId === assistantRequestId
            ? {
                ...message,
                isThinking: false,
                thoughtSteps: finalizeThoughtSteps(
                  message.thoughtSteps,
                  message.status === 'error' ? 'error' : 'success',
                ),
                status: message.status === 'error' ? 'error' : 'done',
              }
            : message,
        ),
      }));
    } catch (error) {
      const isAborted =
        error instanceof DOMException && error.name === 'AbortError';

      setMessageMap((prev) => ({
        ...prev,
        [targetKey]: (prev[targetKey] ?? []).map((message) =>
          message.requestId === assistantRequestId
            ? {
                ...message,
                content:
                  message.content ||
                  (isAborted ? '已停止生成。' : '请求失败，请稍后重试。'),
                isThinking: false,
                thoughtSteps: (message.thoughtSteps ?? []).map((step) =>
                  step.status === 'loading'
                    ? {
                        ...step,
                        status: isAborted ? 'abort' : 'error',
                      }
                    : step,
                ),
                status: isAborted ? 'done' : 'error',
              }
            : message,
        ),
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsRequesting(false);
      void refreshWorkspaceTree({ silent: true });
    }
  };

  const newChat = () => {
    const conversation = createDraftConversation();
    if (selectedAgentName) {
      setConversationAgentMap((previousMap) => {
        const nextMap = {
          ...previousMap,
          [conversation.key]: selectedAgentName,
        };
        writeConversationAgentMap(nextMap);
        return nextMap;
      });
    }
    setConversations((prev) => [
      conversation,
      ...prev,
    ]);
    setMessageMap((prev) => ({ ...prev, [conversation.key]: [] }));
    setActiveKey(conversation.key);
  };

  const abort = () => {
    abortRef.current?.abort();
  };

  const removeConversation = async (conversation: {
    key: string;
    isDraft?: boolean;
  }) => {
    if (!conversation.isDraft) {
      try {
        await deleteChatHistory(conversation.key);
      } catch (error) {
        console.error('删除会话失败', error);
        return;
      }
    }

    setConversations((prev) => {
      const next = prev.filter((item) => item.key !== conversation.key);
      setConversationAgentMap((previousMap) => {
        if (!(conversation.key in previousMap)) {
          return previousMap;
        }

        const nextMap = { ...previousMap };
        delete nextMap[conversation.key];
        writeConversationAgentMap(nextMap);
        return nextMap;
      });
      setMessageMap((prevMap) => {
        const nextMap = { ...prevMap };
        delete nextMap[conversation.key];
        return nextMap;
      });

      if (next.length === 0) {
        const draftConversation = createDraftConversation();
        setMessageMap((prevMap) => ({
          ...prevMap,
          [draftConversation.key]: [],
        }));
        setActiveKey(draftConversation.key);
        return [draftConversation];
      }

      if (activeKey === conversation.key) {
        abort();
        setActiveKey(next[0].key);
      }

      return next;
    });
  };

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      activeMessages.map((message) => {
        const isAI = message.role === 'assistant';
        const isUpdating = message.status === 'updating';
        const thoughtChainItems = isAI
          ? toThoughtChainItems(message.thoughtSteps, Boolean(message.isThinking))
          : [];
        const hasVisibleContent = Boolean(
          message.content || thoughtChainItems.length > 0,
        );

        const item: BubbleItemType = {
          key: message.requestId ?? message.id,
          role: isAI ? 'ai' : 'user',
          content: message.content,
          loading: isAI && isUpdating && !hasVisibleContent,
          status: isUpdating ? 'updating' : undefined,
        };

        if (!isAI && message.attachments?.length) {
          item.header = renderMessageAttachments(message.attachments);
        }

        if (isAI && thoughtChainItems.length > 0) {
          const messageKey = message.requestId ?? message.id;
          const expandedKeys = thoughtChainExpandedMap[messageKey] ?? [];
          item.header = (
            <div className={styles.thoughtChainWrap}>
              <ThoughtChain
                items={thoughtChainItems}
                expandedKeys={expandedKeys}
                onExpand={(nextExpandedKeys) => {
                  setThoughtChainExpandedMap((previousMap) => {
                    const currentExpandedKeys = previousMap[messageKey] ?? [];
                    if (
                      currentExpandedKeys.length === nextExpandedKeys.length
                      && currentExpandedKeys.every(
                        (key, index) => key === nextExpandedKeys[index],
                      )
                    ) {
                      return previousMap;
                    }

                    return {
                      ...previousMap,
                      [messageKey]: nextExpandedKeys.map(String),
                    };
                  });
                }}
                styles={THOUGHT_CHAIN_STYLES}
              />
            </div>
          );
        }

        return item;
      }),
    [activeMessages, styles.thoughtChainWrap, thoughtChainExpandedMap],
  );

  const hasMessages = activeMessages.length > 0;
  const composerNode = (
    <div className={styles.composerStack}>
      <div className={styles.selectorsCard}>
        <div className={styles.selectorGrid}>
          <div className={styles.selectorField}>
            <Typography.Text className={styles.selectorLabel}>
              当前 Agent
            </Typography.Text>
            <Select
              value={selectedAgentName}
              options={agentOptions}
              placeholder="请选择 Agent"
              onChange={handleAgentChange}
            />
          </div>
        </div>
        <Typography.Text type="secondary" className={styles.selectorHint}>
          Skills 将由 Agent 按提问自动按需加载，无需手动选择。
        </Typography.Text>
      </div>
      <div className={styles.senderShell} ref={senderShellRef}>
        <div className={styles.senderRow}>
          <div className={styles.attachmentRail}>
            <Attachments
              ref={attachmentsRef}
              customRequest={handleAttachmentUpload}
              onChange={({ fileList }) =>
                handleAttachmentItemsChange(fileList as AttachmentItem[])
              }
              beforeUpload={() => true}
              getDropContainer={() => senderShellRef.current ?? document.body}
              multiple
              maxCount={10}
            >
              <Button
                type="text"
                icon={<PaperClipOutlined />}
                className={styles.attachmentTrigger}
              />
            </Attachments>
          </div>
          <div className={styles.senderPanel}>
            <Sender
              header={
                attachmentItems.length > 0 ? (
                  <div className={styles.attachmentPreview}>
                    <FileCard.List
                      size="small"
                      overflow="wrap"
                      removable
                      items={attachmentItems.map((item) => {
                        const attachment = item.response;
                        const fallbackName = item.name ?? attachment?.name ?? 'unknown';
                        const fileExtension = fallbackName.includes('.')
                          ? fallbackName.slice(fallbackName.lastIndexOf('.') + 1).toLowerCase()
                          : '';
                        const fallbackKind: ChatAttachment['kind'] =
                          attachment?.kind ??
                          (item.type?.startsWith('image/')
                            ? 'image'
                            : ['md', 'mdx', 'doc', 'docx', 'pdf', 'txt', 'rtf', 'ppt', 'pptx'].includes(fileExtension)
                              ? 'document'
                              : ['csv', 'xlsx', 'xls'].includes(fileExtension)
                                ? 'spreadsheet'
                                : ['py', 'js', 'jsx', 'ts', 'tsx', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'json', 'yaml', 'yml', 'xml', 'html', 'css'].includes(fileExtension)
                                  ? 'text'
                                  : 'binary');
                        const fallbackSize =
                          typeof item.size === 'number' ? item.size : attachment?.size ?? 0;
                        const placeholderAttachment: ChatAttachment = {
                          token: item.uid ?? item.response?.token ?? fallbackName,
                          name: fallbackName,
                          kind: fallbackKind,
                          size: fallbackSize,
                          mimeType: item.type ?? attachment?.mimeType ?? 'application/octet-stream',
                        };
                        const preview = attachment ?? placeholderAttachment;
                        const previewSrc =
                          preview.kind === 'image'
                            ? getAttachmentPreviewUrl(item)
                            : attachment?.url;
                        const isUploading = item.status === 'uploading';
                        const hasError = item.status === 'error';
                        const description = hasError
                          ? '上传失败，可右侧删除重试'
                          : undefined;
                        return toFileCardProps(preview, {
                          src: previewSrc,
                          loading: isUploading,
                          description,
                        });
                      })}
                      onRemove={(target) => {
                        const nextItems = attachmentItems.filter(
                          (item) =>
                            (item.response?.token ?? item.uid ?? item.name) !== target.key,
                        );
                        handleAttachmentItemsChange(nextItems);
                      }}
                    />
                  </div>
                ) : null
              }
              value={inputValue}
              onChange={setInputValue}
              loading={isRequesting}
              onSubmit={sendMessage}
              onCancel={abort}
              onPasteFile={(files) => {
                Array.from(files).forEach((file) => {
                  attachmentsRef.current?.upload(file);
                });
              }}
              placeholder={
                selectedAgentName
                  ? '输入消息，按 Enter 发送，或附带文件一起提问...'
                  : '请先选择可用的 Agent'
              }
              autoSize={{ minRows: hasMessages ? 2 : 3, maxRows: 8 }}
              style={{ width: '100%' }}
              styles={{
                input: { paddingBlock: 0 },
                content: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <PageContainer
      className={styles.pageContainer}
      ghost
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 100px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: 0,
        paddingInline: 0,
      }}
    >
      <Card
        variant="borderless"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        styles={{
          body: {
            flex: 1,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <XProvider>
          <div className={styles.layout} ref={layoutRef}>
            <div
              className={styles.sidebar}
              style={{ width: panelLayout.leftWidth, flex: `0 0 ${panelLayout.leftWidth}px` }}
            >
              <Conversations
                items={conversations}
                activeKey={activeKey}
                onActiveChange={handleActiveChange}
                groupable
                menu={(conversation) => ({
                  items: [{ key: 'delete', label: '删除', danger: true }],
                  onClick: async ({ key }) => {
                    if (key === 'delete') {
                      await removeConversation(conversation);
                    }
                  },
                })}
                creation={{ onClick: newChat, label: '新建对话' }}
              />
            </div>

            <div
              className={styles.resizeHandle}
              onMouseDown={startResize('left')}
            />

            <div className={styles.main}>
              {hasMessages && (
                <div key={activeKey} className={styles.messages}>
                  <Bubble.List
                    key={activeKey}
                    items={bubbleItems}
                    role={roleConfig}
                    styles={{ root: { maxWidth: 940 } }}
                  />
                </div>
              )}

              <div
                className={hasMessages ? styles.footer : styles.footerCenter}
              >
                {!hasMessages && (
                  <div className={styles.welcomeTitle}>
                    <TypewriterTitle />
                  </div>
                )}
                {composerNode}
              </div>
            </div>

            <div
              className={styles.resizeHandle}
              onMouseDown={startResize('right')}
            />

            <div
              className={styles.workspace}
              style={{ width: panelLayout.rightWidth, flex: `0 0 ${panelLayout.rightWidth}px` }}
            >
              <div className={styles.workspaceInner}>
                <div className={styles.workspaceToolbar}>
                  <Typography.Text type="secondary">
                    工作区文件管理
                  </Typography.Text>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      void refreshWorkspaceTree();
                    }}
                  >
                    刷新
                  </Button>
                </div>
                <Folder
                  className={styles.workspaceFolder}
                  treeData={workspaceTree}
                  fileContentService={workspaceFileContentService}
                  expandedPaths={workspaceExpandedPaths}
                  onExpandedPathsChange={setWorkspaceExpandedPaths}
                  selectedFile={selectedWorkspaceFile}
                  onSelectedFileChange={(file) => {
                    setSelectedWorkspaceFile(file.path);
                  }}
                  defaultExpandAll={false}
                  directoryTitle={(
                    <Space size={8}>
                      <FolderOpenOutlined />
                      <span>{WORKSPACE_ROOT}</span>
                    </Space>
                  )}
                  previewTitle={({ title, path }) => (
                    <span>{toWorkspaceFilePath(path) || String(title)}</span>
                  )}
                  emptyRender="工作区目录为空"
                  previewRender={(file, info) => (
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {file.content ? info.originNode : '请选择一个文件查看内容'}
                    </div>
                  )}
                />
              </div>
            </div>
          </div>
        </XProvider>
      </Card>
    </PageContainer>
  );
};

export default ChatbotPage;
