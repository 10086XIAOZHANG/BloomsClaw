import { PageContainer } from '@ant-design/pro-components';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

import type { McpConfig, RemoteMcpToolMeta, ToolItem } from '../data';
import {
  MCP_TRANSPORT_OPTIONS,
  createEmptyTool,
  parseHeadersText,
  parseMultilineText,
  parseEnvText,
  stringifyEnvRecord,
  stringifyHeadersRecord,
} from '../data';
import {
  createToolItem,
  deleteToolItem,
  getBloomsClawToolsConfig,
  listRemoteMcpTools,
  saveToolItem,
} from '../service';

type McpFormValues = {
  name: string;
  description: string;
  enabled: boolean;
  transport: McpConfig['transport'];
  command?: string;
  argsText?: string;
  envText?: string;
  cwd?: string;
  url?: string;
  headersText?: string;
};

const toMcpFormValues = (tool: ToolItem): McpFormValues => {
  const mcp = tool.mcp;
  return {
    name: tool.name ?? '',
    description: tool.description ?? '',
    enabled: tool.enabled ?? true,
    transport: mcp?.transport ?? 'stdio',
    command: mcp?.command ?? 'npx',
    argsText: (mcp?.args ?? []).join('\n'),
    envText: stringifyEnvRecord(mcp?.env),
    cwd: mcp?.cwd ?? '',
    url: mcp?.url ?? '',
    headersText: stringifyHeadersRecord(mcp?.headers),
  };
};

const buildMcpConfig = (values: McpFormValues): McpConfig => {
  if (values.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: (values.command ?? '').trim(),
      args: parseMultilineText(values.argsText ?? ''),
      env: parseEnvText(values.envText ?? ''),
      ...(values.cwd?.trim() ? { cwd: values.cwd.trim() } : {}),
    };
  }
  return {
    transport: values.transport,
    url: (values.url ?? '').trim(),
    headers: parseHeadersText(values.headersText ?? ''),
  };
};

const ToolsPage: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm<McpFormValues>();
  const [loading, setLoading] = useState(true);
  const [savingToolId, setSavingToolId] = useState<string>();
  const [deletingToolId, setDeletingToolId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [remoteToolsById, setRemoteToolsById] = useState<Record<string, RemoteMcpToolMeta[]>>({});
  const [remoteLoadingId, setRemoteLoadingId] = useState<string>();
  const transport = Form.useWatch('transport', form);

  const enabledCount = useMemo(
    () => tools.filter((item) => item?.enabled).length,
    [tools],
  );

  const builtinCount = useMemo(
    () => tools.filter((item) => item?.builtin).length,
    [tools],
  );

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await getBloomsClawToolsConfig();
      setTools(config.tools);
    } catch {
      message.error('读取 Tools 配置失败，请确认 API 服务已启动');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleToggle = async (toolId: string, checked: boolean) => {
    const previousTools = tools;
    const nextTools = tools.map((item) =>
      item.id === toolId ? { ...item, enabled: checked } : item,
    );
    const currentTool = nextTools.find((item) => item.id === toolId);

    setTools(nextTools);
    setSavingToolId(toolId);

    try {
      if (!currentTool) {
        return;
      }

      const next = await saveToolItem(currentTool);
      setTools(next.tools);
    } catch {
      setTools(previousTools);
      message.error('工具状态保存失败，请重试');
    } finally {
      setSavingToolId(undefined);
    }
  };

  const handleOpenCreate = () => {
    form.setFieldsValue(toMcpFormValues(createEmptyTool()));
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const name = values.name?.trim() ?? '';
      const description = values.description?.trim() ?? '';
      if (!name || !description) {
        return;
      }
      setCreating(true);
      const next = await createToolItem({
        id: '',
        name,
        description,
        builtin: false,
        enabled: values.enabled ?? true,
        mcp: buildMcpConfig(values),
      });
      setTools(next.tools);
      setCreateOpen(false);
      message.success(`MCP 工具「${name}」已创建并连通`);
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message || '新建 MCP 工具失败，请重试');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (toolId: string) => {
    setDeletingToolId(toolId);
    try {
      const next = await deleteToolItem(toolId);
      setTools(next.tools);
      message.success('工具已删除');
    } catch {
      message.error('删除工具失败，请重试');
    } finally {
      setDeletingToolId(undefined);
    }
  };

  const handleInspectRemote = async (tool: ToolItem) => {
    setRemoteLoadingId(tool.id);
    try {
      const remoteTools = await listRemoteMcpTools(tool.id);
      setRemoteToolsById((previous) => ({ ...previous, [tool.id]: remoteTools }));
      if (remoteTools.length === 0) {
        message.warning('已连通，但该 MCP Server 未暴露任何工具');
      } else {
        message.success(`已连通，共发现 ${remoteTools.length} 个远端工具`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '连接 MCP Server 失败');
    } finally {
      setRemoteLoadingId(undefined);
    }
  };

  const renderMcpSummary = (tool: ToolItem) => {
    const mcp = tool.mcp;
    if (!mcp) {
      return <Typography.Text type="danger">缺少 MCP 配置（老数据，请删除重建）</Typography.Text>;
    }
    if (mcp.transport === 'stdio') {
      return (
        <Typography.Text code copyable={{ tooltips: false }}>
          {`${mcp.command ?? ''} ${(mcp.args ?? []).join(' ')}`.trim() || 'stdio'}
        </Typography.Text>
      );
    }
    return (
      <Typography.Text code copyable={{ tooltips: false }}>
        {mcp.url ?? ''}
      </Typography.Text>
    );
  };

  return (
    <PageContainer title="Tools">
      <Card loading={loading}>
        <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
          <Row gutter={[16, 16]} style={{ flex: 1 }}>
            <Col flex="220px">
              <Card size="small" styles={{ body: { minWidth: 180 } }}>
                <Statistic title="已启用工具" value={enabledCount} />
              </Card>
            </Col>
            <Col flex="220px">
              <Card size="small" styles={{ body: { minWidth: 180 } }}>
                <Statistic title="内置工具" value={builtinCount} />
              </Card>
            </Col>
          </Row>
          <Space wrap>
            <Button icon={<PlusOutlined />} type="primary" onClick={handleOpenCreate}>
              新建 MCP 工具
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
              重新加载
            </Button>
          </Space>
        </Space>

        {tools.length === 0 ? (
          <Empty description="暂无工具配置，点击右上角新建 MCP 工具" />
        ) : (
          <Row gutter={[16, 16]}>
            {tools.map((tool, index) => {
              const remoteTools = remoteToolsById[tool.id];
              return (
                <Col key={tool.id} xs={24} md={12} xl={8}>
                  <Card
                    title={
                      <Space>
                        <Typography.Text strong>
                          {tool.name || `Tool ${index + 1}`}
                        </Typography.Text>
                        <Tag color={tool.builtin ? 'blue' : 'purple'}>
                          {tool.builtin ? '内置' : 'MCP'}
                        </Tag>
                      </Space>
                    }
                    extra={
                      <Space>
                        <Switch
                          checked={tool.builtin ? true : tool.enabled}
                          loading={savingToolId === tool.id}
                          disabled={tool.builtin || savingToolId === tool.id}
                          checkedChildren="启用"
                          unCheckedChildren="停用"
                          onChange={(checked) => void handleToggle(tool.id, checked)}
                        />
                        {tool.builtin ? null : (
                          <Popconfirm
                            title="确认删除该 MCP 工具吗？"
                            description={`删除后将移除「${tool.name}」的配置`}
                            okText="确认删除"
                            cancelText="取消"
                            onConfirm={() => void handleDelete(tool.id)}
                          >
                            <Button
                              danger
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              loading={deletingToolId === tool.id}
                            />
                          </Popconfirm>
                        )}
                      </Space>
                    }
                    style={{ height: '100%' }}
                  >
                    <Typography.Paragraph style={{ minHeight: 44 }}>
                      {tool.description}
                    </Typography.Paragraph>

                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <Space wrap>
                        <Tag color={tool.enabled ? 'green' : 'default'}>
                          {tool.enabled ? '已启用' : '已停用'}
                        </Tag>
                        <Tag color={tool.builtin ? 'blue' : 'default'}>
                          {tool.builtin ? '内置' : 'MCP'}
                        </Tag>
                        {tool.builtin ? null : (
                          <Tag color="cyan">
                            {tool.mcp?.transport ?? '未知传输'}
                          </Tag>
                        )}
                      </Space>

                      {tool.builtin ? null : (
                        <>
                          <Descriptions size="small" column={1} bordered>
                            <Descriptions.Item label="MCP 连接">
                              {renderMcpSummary(tool)}
                            </Descriptions.Item>
                          </Descriptions>
                          <Space wrap>
                            <Button
                              size="small"
                              loading={remoteLoadingId === tool.id}
                              onClick={() => void handleInspectRemote(tool)}
                            >
                              测试连接并查看远端工具
                            </Button>
                          </Space>
                          {remoteTools ? (
                            <Space wrap>
                              {remoteTools.map((remote) => (
                                <Tag key={remote.name} color="geekblue" title={remote.description}>
                                  {remote.name}
                                </Tag>
                              ))}
                            </Space>
                          ) : null}
                        </>
                      )}
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Card>

      <Modal
        title="新建 MCP 工具（一个配置 = 一个 MCP Server）"
        open={createOpen}
        onOk={() => void handleCreate()}
        onCancel={() => setCreateOpen(false)}
        okText="创建并测试连接"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="MCP 名称（给 Agent 绑定的 ID）"
            name="name"
            rules={[
              { required: true, message: '请输入 MCP 名称' },
              { max: 64, message: '名称最多 64 个字符' },
            ]}
          >
            <Input placeholder="例如：filesystem / github / postgres" />
          </Form.Item>
          <Form.Item
            label="描述"
            name="description"
            rules={[{ required: true, message: '请输入描述' }]}
          >
            <Input.TextArea rows={2} placeholder="描述这个 MCP Server 的用途" />
          </Form.Item>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Form.Item
            label="传输方式"
            name="transport"
            rules={[{ required: true, message: '请选择传输方式' }]}
          >
            <Select options={MCP_TRANSPORT_OPTIONS} />
          </Form.Item>

          {transport === 'stdio' ? (
            <>
              <Form.Item
                label="启动命令"
                name="command"
                rules={[{ required: true, message: '请输入启动命令，例如 npx' }]}
              >
                <Input placeholder="npx / uvx / python / node" />
              </Form.Item>
              <Form.Item label="启动参数（每行一个）" name="argsText">
                <Input.TextArea rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/jack/.blooms_claw/workspaces'} />
              </Form.Item>
              <Form.Item label="环境变量（每行 KEY=VALUE）" name="envText">
                <Input.TextArea rows={2} placeholder={'API_KEY=xxx\nDEBUG=1'} />
              </Form.Item>
              <Form.Item label="工作目录（可选）" name="cwd">
                <Input placeholder="留空则继承后端进程目录" />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                label="服务端地址"
                name="url"
                rules={[
                  { required: true, message: '请输入服务端地址' },
                  { type: 'url', message: '请输入合法的 http(s) 地址' },
                ]}
              >
                <Input placeholder="https://mcp.example.com/mcp" />
              </Form.Item>
              <Form.Item label="请求头（每行 Key: Value）" name="headersText">
                <Input.TextArea rows={2} placeholder={'Authorization: Bearer xxx'} />
              </Form.Item>
            </>
          )}
          <Typography.Paragraph type="secondary">
            创建时会实际连接该 MCP Server 并读取工具列表，连不通则拒绝保存，保证 Agent 运行时一定可调用。
          </Typography.Paragraph>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ToolsPage;
