import {
  BulbOutlined,
  CodeOutlined,
  CompassOutlined,
  EditOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LeftOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Attachments, Bubble, Conversations, FileCard, Folder, Sender, ThoughtChain, XProvider } from '@ant-design/x';
import type { BubbleItemType, BubbleListProps, FileCardProps, ThoughtChainItemType } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import { App, Avatar, Button, ConfigProvider, Form, Input, InputNumber, Select, Space, Switch, Tooltip, Typography } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import type { UploadRequestOption as RcCustomRequestOptions } from 'rc-upload/lib/interface';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { history, useModel } from '@umijs/max';

import type {
  ChatAgentOption,
  ChatAttachment,
  ChatMessage,
  ChatThoughtStep,
  ChatInterruptPayload,
  ConversationItem,
} from './data';
import { AvatarDropdown } from '@/components/RightContent/AvatarDropdown';
import { UserAuthModal } from '@/components/UserAuthModal';
import { subscribeUserChange } from '@/utils/userSession';
import {
  deleteChatHistory,
  getWorkspaceFileContent,
  getWorkspaceTree,
  listSelectableAgents,
  listChatHistory,
  resumeChatCompletion,
  streamChatCompletion,
  uploadChatAttachments,
  type WorkspaceTreeNode,
} from './service';
import { useStyles } from './style';

const WELCOME_TEXT = '你好，我是 BloomsClaw';
const WELCOME_SUB = '有问题尽管问我，或试试下面的灵感';
const DOUBAO_SUGGESTS = [
  { icon: <EditOutlined />, bg: '#eef0ff', title: '帮我写作', desc: '起草文案、润色文章、生成大纲', prompt: '帮我写一篇关于 AI 智能体发展趋势的短文大纲' },
  { icon: <CodeOutlined />, bg: '#e6f7ef', title: '帮我编程', desc: '写代码、查 Bug、解释逻辑', prompt: '用 TypeScript 写一个带重试的 fetch 封装，并解释关键逻辑' },
  { icon: <BulbOutlined />, bg: '#fff4e0', title: '出谋划策', desc: '头脑风暴、做计划、给建议', prompt: '帮我制定一份两周学会 AI 智能体编排的学习计划' },
  { icon: <SearchOutlined />, bg: '#f0eaff', title: '查资料总结', desc: '提炼要点、对比分析、做摘要', prompt: '总结一下大模型 Agent 的核心能力，并对比 ReAct 与 Plan-and-Execute' },
];
const CHATBOT_CONVERSATION_AGENT_STORAGE_KEY =
  'blooms_claw.chatbot.conversation_agents';
const CHATBOT_CONVERSATION_ID_QUERY_KEY = 'conversationId';
const CHATBOT_PANEL_LAYOUT_STORAGE_KEY = 'blooms_claw.chatbot.panel_layout';

type ConversationAgentMap = Record<string, string>;
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
  background: 'linear-gradient(135deg, #4d6bfe 0%, #8a9bff 100%)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const USER_AVATAR_STYLE: React.CSSProperties = {
  background: '#1d1d1f',
  color: '#fff',
};

const sanitizeThinkText = (content: string): string =>
  content
    .replace(THINK_TAG_PATTERN, '')
    .replace(THINK_TAG_PREFIX_PATTERN, '');

const aiAvatarNode = <Avatar style={AI_AVATAR_STYLE}>B</Avatar>;
const userAvatarNode = <Avatar icon={<UserOutlined />} style={USER_AVATAR_STYLE} />;
const DRAFT_CONVERSATION_LABEL = '新对话';

type InterruptFormProps = {
  interrupt: ChatInterruptPayload;
  submitting: boolean;
  onSubmit: (value: Record<string, unknown>) => void;
};

const InterruptForm: React.FC<InterruptFormProps> = ({ interrupt, submitting, onSubmit }) => {
  const [form] = Form.useForm();
  const fields = interrupt.fields ?? [];
  const actions = interrupt.actionRequests ?? [];

  if (actions.length > 0) {
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text>{interrupt.question ?? '工具执行前需要你的确认'}</Typography.Text>
        {actions.map((action, index) => (
          <Typography.Text type="secondary" key={`${action.name ?? 'action'}-${index}`}>
            {action.description ?? action.name ?? '待确认操作'}
          </Typography.Text>
        ))}
        <Space>
          <Button
            type="primary"
            loading={submitting}
            onClick={() =>
              onSubmit({
                decisions: actions.map(() => ({ type: 'approve' })),
              })
            }
          >
            同意执行
          </Button>
          <Button
            disabled={submitting}
            onClick={() =>
              onSubmit({
                decisions: actions.map(() => ({
                  type: 'reject',
                  message: '用户拒绝执行',
                })),
              })
            }
          >
            拒绝
          </Button>
        </Space>
      </Space>
    );
  }

  return (
    <Form form={form} layout="vertical" size="small" onFinish={(values) => onSubmit(fields.length === 0 ? { answer: values.answer } : values as Record<string, unknown>)} style={{ minWidth: 360, maxWidth: 560 }}>
      <Typography.Text>{interrupt.question ?? '请提供信息'}</Typography.Text>
      {fields.length === 0 ? (
        <Form.Item name="answer" rules={[{ required: true, message: '请输入回答' }]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder="请输入回答" />
        </Form.Item>
      ) : fields.map((field) => (
        <Form.Item
          key={field.name}
          name={field.name}
          label={field.label}
          valuePropName={field.name === 'secure' ? 'checked' : undefined}
          rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined}
        >
          {field.name === 'port' ? (
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder={field.example} />
          ) : field.name === 'secure' ? (
            <Switch />
          ) : field.secret ? (
            <Input.Password autoComplete="new-password" placeholder={field.example} />
          ) : (
            <Input placeholder={field.example} />
          )}
        </Form.Item>
      ))}
      <Button type="primary" htmlType="submit" loading={submitting}>提交并继续</Button>
    </Form>
  );
};

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const createDraftConversation = (): ConversationItem => ({
  key: createId(),
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

const SANDBOX_WORKSPACE_ROOT = 'sandbox:/workspace';

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
    status?: 'updating' | 'done' | 'error' | 'waiting';
  },
): ChatMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  attachments: message.attachments,
  pendingInterrupt: (() => {
    const interruptStep = message.thoughtSteps?.find((step) => step.key.endsWith(':interrupt'));
    if (message.status !== 'waiting' || !interruptStep?.content) return undefined;
    try {
      return JSON.parse(interruptStep.content) as ChatInterruptPayload;
    } catch {
      return undefined;
    }
  })(),
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
          status:
            message.status === 'done' &&
            (step.status === 'loading' || step.status === 'waiting')
              ? 'success'
              : step.status,
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
    || (message.status === 'waiting' &&
      Boolean(message.thoughtSteps?.some((step) => step.status === 'waiting'))),
  status:
    message.status === 'error'
      ? 'error'
      : message.status === 'waiting'
        ? 'waiting'
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
    step.status === 'loading' || step.status === 'waiting'
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
    status: step.status === 'waiting' ? 'loading' : step.status,
    collapsible: Boolean(step.content),
    blink: isStreaming && step.status === 'loading',
  }));

const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    avatar: userAvatarNode,
    variant: 'filled',
  },
  ai: {
    placement: 'start',
    avatar: aiAvatarNode,
    variant: 'borderless',
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
  const { initialState } = useModel('@@initialState');
  const currentUserName = initialState?.currentUser?.name || '未登录';
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
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceVisible, setWorkspaceVisible] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [userSessionVersion, setUserSessionVersion] = useState(0);

  useEffect(() => {
    return subscribeUserChange(() => {
      setConversations([]);
      setMessageMap({});
      setActiveKey('');
      setWorkspaceTree([]);
      setWorkspaceExpandedPaths([]);
      setSelectedWorkspaceFile(undefined);
      setHasResolvedInitialConversation(false);
      setUserSessionVersion((version) => version + 1);
    });
  }, []);
  const activeMessages = messageMap[activeKey] ?? [];
  const filteredConversations = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return conversations;
    return conversations.filter((c) =>
      String(c.label ?? '').toLowerCase().includes(kw),
    );
  }, [conversations, searchKeyword]);
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
      loadFileContent: async (filePath: string) => getWorkspaceFileContent(filePath, activeKey),
    }),
    [activeKey],
  );
  const refreshWorkspaceTree = useCallback(
    async (options?: { silent?: boolean }) => {
      try {
        const workspace = await getWorkspaceTree(activeKey);
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
    [message, activeKey],
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
    return subscribeUserChange(() => {
      setConversations([]);
      setMessageMap({});
      setActiveKey('');
      setWorkspaceTree([]);
      setWorkspaceExpandedPaths([]);
      setSelectedWorkspaceFile(undefined);
      setHasResolvedInitialConversation(false);
      setUserSessionVersion((version) => version + 1);
    });
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
          const draftConversation = createDraftConversation();
          setConversations([draftConversation]);
          setMessageMap({ [draftConversation.key]: [] });
          setActiveKey(draftConversation.key);
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
  }, [userSessionVersion]);

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
  }, [userSessionVersion]);

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
      id: createId(),
      role: 'user',
      content: userContent,
      attachments: currentAttachments,
      status: 'done',
    };
    const assistantRequestId = createId();

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
                      : chunk.type === 'interrupt'
                      ? {
                          pendingInterrupt: chunk.interrupt,
                          isThinking: false,
                          thoughtSteps: upsertThoughtStep(message.thoughtSteps, {
                            key: `${assistantRequestId}:interrupt`,
                            title: '等待用户输入',
                            description: chunk.interrupt.question ?? '请填写表单后继续',
                            content: JSON.stringify(chunk.interrupt),
                            status: 'waiting',
                          }),
                          status: 'waiting' as const,
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
                status: message.status === 'error'
                  ? 'error'
                  : message.status === 'waiting'
                    ? 'waiting'
                    : 'done',
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

  const resumePendingInterrupt = async (value: Record<string, unknown>) => {
    if (isRequesting) return;
    const targetKey = activeKey;
    const pendingMessage = (messageMap[targetKey] ?? []).find(
      (item) => item.role === 'assistant' && item.status === 'waiting' && item.pendingInterrupt,
    );
    if (!pendingMessage) return;

    setIsRequesting(true);
    const pendingInterrupt = pendingMessage.pendingInterrupt;
    const isToolApproval = (pendingInterrupt?.actionRequests?.length ?? 0) > 0;
    const resumeValue = isToolApproval || 'decisions' in value
      ? value
      : String(value.answer ?? '');
    try {
      await resumeChatCompletion(resumeValue, {
        id: targetKey,
        agentName: conversationAgentMap[targetKey] || selectedAgentName,
        skillNames: [],
        onChunk: (chunk) => {
          setMessageMap((prev) => ({
            ...prev,
            [targetKey]: (prev[targetKey] ?? []).map((message) => {
              if (message.requestId !== pendingMessage.requestId) return message;
              if (chunk.type === 'thinking_delta') {
                const rawThinkContent = `${message.rawThinkContent ?? ''}${chunk.delta}`;
                const thinkContent = sanitizeThinkText(rawThinkContent);
                const reasoningStepKey = getReasoningStepKey(message.thoughtSteps);
                return {
                  ...message,
                  id: chunk.id || message.id,
                  rawThinkContent,
                  thinkContent,
                  isThinking: true,
                  status: 'updating' as const,
                  thoughtSteps: upsertThoughtStep(message.thoughtSteps, {
                    key: reasoningStepKey,
                    title: '深度思考',
                    description: '模型正在分析问题并规划执行步骤',
                    content: thinkContent,
                    status: 'loading',
                  }),
                };
              }
              if (chunk.type === 'thought_step') {
                return {
                  ...message,
                  id: chunk.id || message.id,
                  thoughtSteps: upsertThoughtStep(message.thoughtSteps, chunk.step),
                };
              }
              if (chunk.type === 'interrupt') {
                return {
                  ...message,
                  id: chunk.id || message.id,
                  pendingInterrupt: chunk.interrupt,
                  thoughtSteps: upsertThoughtStep(message.thoughtSteps, {
                    key: `${pendingMessage.requestId}:interrupt`,
                    title: '等待用户输入',
                    description: chunk.interrupt.question ?? '请填写表单后继续',
                    content: JSON.stringify(chunk.interrupt),
                    status: 'waiting',
                  }),
                  status: 'waiting' as const,
                  isThinking: false,
                };
              }
              if (chunk.type === 'content_delta') {
                return {
                  ...message,
                  id: chunk.id || message.id,
                  content: `${message.content}${chunk.delta}`,
                  pendingInterrupt: undefined,
                  status: 'updating' as const,
                };
              }
              if (chunk.type === 'error') {
                return {
                  ...message,
                  content: message.content || chunk.error,
                  thoughtSteps: finalizeThoughtSteps(message.thoughtSteps, 'error'),
                  status: 'error' as const,
                  pendingInterrupt: undefined,
                  isThinking: false,
                };
              }
              if (chunk.type === 'done') {
                return {
                  ...message,
                  thoughtSteps: finalizeThoughtSteps(message.thoughtSteps, 'success'),
                  status: 'done' as const,
                  pendingInterrupt: undefined,
                  isThinking: false,
                };
              }
              return message;
            }),
          }));
        },
      });
      setMessageMap((prev) => ({
        ...prev,
        [targetKey]: (prev[targetKey] ?? []).map((message) =>
          message.requestId === pendingMessage.requestId && message.status === 'updating'
            ? {
                ...message,
                isThinking: false,
                thoughtSteps: finalizeThoughtSteps(message.thoughtSteps, 'success'),
                status: 'done' as const,
                pendingInterrupt: undefined,
              }
            : message,
        ),
      }));
    } catch (error) {
      setMessageMap((prev) => ({
        ...prev,
        [targetKey]: (prev[targetKey] ?? []).map((message) =>
          message.requestId === pendingMessage.requestId
            ? { ...message, content: message.content || (error instanceof Error ? error.message : '恢复失败'), status: 'error' as const }
            : message,
        ),
      }));
    } finally {
      setIsRequesting(false);
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
          item.header = (
            <div className={styles.thoughtChainWrap}>
              <ThoughtChain
                items={thoughtChainItems}
                styles={THOUGHT_CHAIN_STYLES}
              />
            </div>
          );
        }

        if (isAI && message.pendingInterrupt && message.status === 'waiting') {
          const interruptForm = (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #d9d9d9', borderRadius: 8 }}>
              <InterruptForm
                interrupt={message.pendingInterrupt}
                submitting={isRequesting}
                onSubmit={resumePendingInterrupt}
              />
            </div>
          );
          item.header = (
            <div className={styles.thoughtChainWrap}>
              {thoughtChainItems.length > 0 ? (
                <ThoughtChain
                  items={thoughtChainItems}
                  styles={THOUGHT_CHAIN_STYLES}
                />
              ) : null}
              {interruptForm}
            </div>
          );
        }

        return item;
      }),
    [activeMessages, styles.thoughtChainWrap],
  );

  const hasMessages = activeMessages.length > 0;
  const composerNode = (
    <div className={styles.composerStack}>
      <div className={styles.composerBox}>
        <div className={styles.senderShell} ref={senderShellRef}>
          <Sender
            prefix={
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
                  className={styles.toolBtn}
                />
              </Attachments>
            }
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
                ? '输入消息，Enter 发送，Shift + Enter 换行'
                : '请先在左下角选择可用的 Agent'
            }
            autoSize={{ minRows: 2, maxRows: 8 }}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div className={styles.composerHint}>
        内容由 AI 生成，仅供参考 · Skills 由 Agent 按需自动加载
      </div>
    </div>
  );

  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgBase: '#ffffff',
          colorTextBase: '#1d1d1f',
          colorLink: '#4d6bfe',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Input: {
            colorBgContainer: '#f4f4f5',
            colorBorder: 'transparent',
            colorText: '#1d1d1f',
            colorTextPlaceholder: '#a1a1aa',
          },
          Select: {
            colorBgContainer: '#ffffff',
            colorBorder: '#e4e4e7',
            colorText: '#1d1d1f',
            colorTextPlaceholder: '#a1a1aa',
            optionSelectedBg: '#ececf1',
          },
          Button: {
            colorPrimary: '#1d1d1f',
            colorPrimaryHover: '#000000',
            colorPrimaryActive: '#000000',
            colorTextLightSolid: '#ffffff',
            primaryShadow: 'none',
          },
          Avatar: {
            colorTextLightSolid: '#ffffff',
          },
        },
      }}
    >
    <div className={styles.pageContainer}>
      <XProvider>
        <div className={styles.layout} ref={layoutRef}>
          {!sidebarCollapsed && (
            <>
              <div
                className={styles.sidebar}
                style={{ width: panelLayout.leftWidth, flex: `0 0 ${panelLayout.leftWidth}px` }}
              >
                <div className={styles.sideHeader}>
                  <div className={styles.logo}>B</div>
                  <span className={styles.appName}>BloomsClaw</span>
                  <div style={{ flex: 1 }} />
                  <Tooltip title="收起边栏">
                    <Button
                      type="text"
                      size="small"
                      icon={<LeftOutlined />}
                      className={styles.topIconBtn}
                      onClick={() => setSidebarCollapsed(true)}
                    />
                  </Tooltip>
                </div>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  className={styles.newChatBtn}
                  onClick={newChat}
                  style={{ marginBottom: 10 }}
                >
                  新建对话
                </Button>
                <div className={styles.navMenu}>
                  <button
                    type="button"
                    className={styles.navItem}
                    onClick={() => history.push('/welcome')}
                  >
                    <CompassOutlined />
                    <span>BloomsClaw 介绍</span>
                  </button>
                  <button
                    type="button"
                    className={styles.navItem}
                    onClick={() => history.push('/agents-config/agents')}
                  >
                    <RobotOutlined />
                    <span>Agent 配置</span>
                    <SettingOutlined className={styles.navArrow} />
                  </button>
                </div>
                <div className={styles.searchInput}>
                  <Input
                    prefix={<SearchOutlined style={{ color: '#a1a1aa' }} />}
                    placeholder="搜索历史对话"
                    variant="filled"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    allowClear
                  />
                </div>
                <div className={styles.convList}>
                  <Conversations
                    items={filteredConversations}
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
                  />
                </div>
                <div className={styles.sideFooter}>
                  <AvatarDropdown
                    menu={false}
                    onUnauthenticatedClick={() => {
                      setAuthModalTab('login');
                      setAuthOpen(true);
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '8px 10px',
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
                          background: currentUserName !== '未登录' ? '#4d6bfe' : '#1d1d1f',
                          color: '#fff',
                        }}
                      >
                        {currentUserName !== '未登录' ? currentUserName.slice(0, 1) : undefined}
                      </Avatar>
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
                    </div>
                  </AvatarDropdown>
                </div>
              </div>
              <div
                className={styles.resizeHandle}
                onMouseDown={startResize('left')}
              />
            </>
          )}

          <div className={styles.main}>
            <div className={styles.topbar}>
              {sidebarCollapsed && (
                <div style={{ position: 'absolute', left: 14, display: 'flex', gap: 4 }}>
                  <Tooltip title="展开边栏">
                    <Button
                      type="text"
                      icon={<RightOutlined />}
                      className={styles.topIconBtn}
                      onClick={() => setSidebarCollapsed(false)}
                    />
                  </Tooltip>
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    className={styles.topIconBtn}
                    onClick={newChat}
                  />
                </div>
              )}
              <Select
                value={selectedAgentName}
                options={agentOptions}
                placeholder="选择 Agent"
                onChange={handleAgentChange}
                variant="borderless"
                className={styles.modelSwitch}
                suffixIcon={<span style={{ fontSize: 11, color: '#71717a' }}>▾</span>}
              />
              <div className={styles.topActions}>
                {!initialState?.currentUser || currentUserName === '未登录' ? (
                  <>
                    <Button
                      type="text"
                      size="small"
                      onClick={() => {
                        setAuthModalTab('login');
                        setAuthOpen(true);
                      }}
                    >
                      登录
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => {
                        setAuthModalTab('register');
                        setAuthOpen(true);
                      }}
                    >
                      注册
                    </Button>
                  </>
                ) : null}
                <Tooltip title={workspaceVisible ? '隐藏工作区' : '显示工作区文件'}>
                  <Button
                    type="text"
                    icon={<FolderOutlined />}
                    className={styles.topIconBtn}
                    onClick={() => setWorkspaceVisible((v) => !v)}
                  />
                </Tooltip>
                <Tooltip title="新对话">
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    className={styles.topIconBtn}
                    onClick={newChat}
                  />
                </Tooltip>
              </div>
            </div>

            {hasMessages ? (
              <div key={activeKey} className={styles.messages}>
                <Bubble.List
                  key={activeKey}
                  items={bubbleItems}
                  role={roleConfig}
                />
              </div>
            ) : (
              <div className={styles.messages} style={{ justifyContent: 'center' }}>
                <div className={styles.welcomeWrap}>
                  <div className={styles.welcomeTitle}>
                    <TypewriterTitle />
                  </div>
                  <div className={styles.welcomeSub}>{WELCOME_SUB}</div>
                  <div className={styles.suggestGrid}>
                    {DOUBAO_SUGGESTS.map((s) => (
                      <button
                        key={s.title}
                        type="button"
                        className={styles.suggestCard}
                        onClick={() => {
                          setInputValue(s.prompt);
                        }}
                      >
                        <span className={styles.suggestIcon} style={{ background: s.bg }}>
                          {s.icon}
                        </span>
                        <span>
                          <div className={styles.suggestTitle}>{s.title}</div>
                          <div className={styles.suggestDesc}>{s.desc}</div>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className={styles.footer}>{composerNode}</div>
          </div>

          {workspaceVisible && (
            <>
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
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      工作区文件
                    </Typography.Text>
                    <Space size={4}>
                      <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        onClick={() => {
                          void refreshWorkspaceTree();
                        }}
                      />
                      <Button
                        size="small"
                        type="text"
                        onClick={() => setWorkspaceVisible(false)}
                      >
                        隐藏
                      </Button>
                    </Space>
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
                        <span style={{ fontSize: 12 }}>{`${SANDBOX_WORKSPACE_ROOT} · ${activeKey.slice(0, 8)}`}</span>
                      </Space>
                    )}
                    previewTitle={({ title, path }) => (
                      <span>{toWorkspaceFilePath(path) || String(title)}</span>
                    )}
                    emptyRender="工作区目录为空"
                    previewRender={(_file, info) => (
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {info.originNode}
                      </div>
                    )}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </XProvider>
      <UserAuthModal
        open={authOpen}
        initialTab={authModalTab}
        onClose={() => setAuthOpen(false)}
      />
    </div>
    </ConfigProvider>
  );
};

export default ChatbotPage;
