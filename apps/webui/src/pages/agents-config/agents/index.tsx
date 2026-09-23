import {
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { subscribeUserChange } from '@/utils/userSession';

import type { AgentItem, ModelItem, ToolItem } from '../data';
import { createEmptyAgent, HITL_TOOL_OPTIONS } from '../data';
import {
  deleteAgentItem,
  getBloomsClawAgentsConfig,
  getBloomsClawModelsConfig,
  getBloomsClawToolsConfig,
  saveAgentItem,
} from '../service';

type AgentFormValues = {
  agents: AgentItem[];
};

/** 所有 agent 自动加载的默认工具，无需在配置里勾选 */
const DEFAULT_AUTO_TOOL_IDS = new Set(['FileTools', 'RunCommand', 'WebSearch']);

const AgentsPage: React.FC = () => {
  const [form] = Form.useForm<AgentFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [savingAgentId, setSavingAgentId] = useState<string>();
  const [deletingAgentId, setDeletingAgentId] = useState<string>();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const agents = Form.useWatch('agents', form) ?? [];

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: `${item.name}${item.enabled ? '' : '（已停用）'}`,
        value: item.id,
      })),
    [models],
  );

  const toolOptions = useMemo(
    () =>
      tools
        .filter((item) => item.enabled)
        // Agents 页只允许绑定 MCP 自定义工具；内置工具由 runtime 自动加载
        .filter((item) => !item.builtin && !DEFAULT_AUTO_TOOL_IDS.has(item.id))
        .map((item) => ({
          label: `${item.name}（MCP · ${item.mcp?.transport ?? '未知传输'}）`,
          value: item.id,
        })),
    [tools],
  );

  const refreshPageData = async () => {
    const [agentsConfig, modelsConfig, toolsConfig] = await Promise.all([
      getBloomsClawAgentsConfig(),
      getBloomsClawModelsConfig(),
      getBloomsClawToolsConfig(),
    ]);

    form.setFieldsValue({
      agents: agentsConfig.agents.map((agent) => ({
        ...agent,
        // 默认工具由 runtime 自动加载，表单只展示可选工具
        toolIds: (agent.toolIds ?? []).filter((id) => !DEFAULT_AUTO_TOOL_IDS.has(id)),
      })),
    });
    setModels(modelsConfig.models.filter((item) => item.enabled));
    setTools(toolsConfig.tools.filter((item) => item.enabled));
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      await refreshPageData();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  // 切换用户后重新加载该用户的 Agents / Models / Tools 配置
  useEffect(() => {
    const unsubscribe = subscribeUserChange(() => {
      void loadConfig();
    });
    return unsubscribe;
  }, []);

  const handleSave = async (fieldName: number) => {
    const fieldPaths = [
      ['agents', fieldName, 'name'],
      ['agents', fieldName, 'modelId'],
      ['agents', fieldName, 'description'],
      ['agents', fieldName, 'systemPrompt'],
      ['agents', fieldName, 'toolIds'],
      ['agents', fieldName, 'humanInTheLoop', 'enabled'],
      ['agents', fieldName, 'humanInTheLoop', 'tools'],
      ['agents', fieldName, 'humanInTheLoop', 'enableAskHuman'],
    ];

    try {
      await form.validateFields(fieldPaths);
      const currentAgents = form.getFieldValue('agents') ?? [];
      const currentAgent = currentAgents[fieldName] as AgentItem | undefined;

      if (!currentAgent) {
        return;
      }

      const enabledToolIds = new Set(toolOptions.map((item) => item.value));
      const normalizedAgent: AgentItem = {
        ...currentAgent,
        toolIds: (currentAgent.toolIds ?? []).filter((id) =>
          enabledToolIds.has(id),
        ),
      };

      setSavingAgentId(normalizedAgent.id);
      await saveAgentItem(normalizedAgent);
      await refreshPageData();
      message.success(`Agent「${normalizedAgent.name || '未命名'}」已保存`);
    } finally {
      setSavingAgentId(undefined);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingAgentId(agentId);
    try {
      await deleteAgentItem(agentId);
      await refreshPageData();
      message.success('Agent 已删除');
    } finally {
      setDeletingAgentId(undefined);
    }
  };

  return (
    <PageContainer title="Agents">
      <Card loading={loading}>
        <Form form={form} layout="vertical">
          <Form.List name="agents">
            {(fields, { add, remove }) => (
              <>
                <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
                  <Space wrap>
                    <Button
                      icon={<PlusOutlined />}
                      type="primary"
                      onClick={() => add(createEmptyAgent())}
                    >
                      新建 Agent
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
                      重新加载
                    </Button>
                  </Space>
                </Space>

                {fields.length === 0 ? (
                  <Empty description="暂无智能体配置" />
                ) : (
                  fields.map((field, index) => {
                    const current = agents[index];
                    return (
                      <Card
                        key={field.key}
                        title={
                          <Space>
                            <Typography.Text strong>
                              {current?.name || `Agent ${index + 1}`}
                            </Typography.Text>
                            <Tag color={current?.enabled ? 'green' : 'default'}>
                              {current?.enabled ? '已启用' : '已停用'}
                            </Tag>
                          </Space>
                        }
                        extra={
                          <Space>
                            <Button
                              icon={<SaveOutlined />}
                              type="primary"
                              loading={Boolean(current?.id && savingAgentId === current.id)}
                              disabled={Boolean(current?.id && deletingAgentId === current.id)}
                              onClick={() => void handleSave(field.name)}
                            >
                              保存配置
                            </Button>
                            {fields.length > 1 ? (
                              <Popconfirm
                                title="确认删除该 Agent 吗？"
                                description={
                                  current?.name
                                    ? `删除后将移除「${current.name}」的配置`
                                    : '删除后将移除当前 Agent 配置'
                                }
                                okText="确认删除"
                                cancelText="取消"
                                onConfirm={() => {
                                  if (current?.name) {
                                    return handleDelete(current.name);
                                  }
                                  remove(field.name);
                                  return Promise.resolve();
                                }}
                              >
                                <Button
                                  danger
                                  icon={<MinusCircleOutlined />}
                                  type="text"
                                  loading={Boolean(current?.name && deletingAgentId === current.name)}
                                  disabled={Boolean(current?.name && savingAgentId === current.name)}
                                >
                                  删除
                                </Button>
                              </Popconfirm>
                            ) : null}
                          </Space>
                        }
                        style={{ marginBottom: 16 }}
                      >
                        <Row gutter={16}>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="智能体名称"
                              name={[field.name, 'name']}
                              rules={[{ required: true, message: '请输入智能体名称' }]}
                            >
                              <Input placeholder="例如：代码审查助手" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="绑定模型"
                              name={[field.name, 'modelId']}
                              rules={[{ required: true, message: '请选择模型' }]}
                            >
                              <Select
                                options={modelOptions}
                                placeholder="请选择模型"
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="MCP 工具"
                              name={[field.name, 'toolIds']}
                              extra="内置工具自动加载，这里只绑定已启用的 MCP 工具"
                            >
                              <Select
                                mode="multiple"
                                allowClear
                                options={toolOptions}
                                placeholder={
                                  toolOptions.length > 0
                                    ? '选择 MCP 工具（可选）'
                                    : '暂无可用 MCP 工具，请先去 Tools 页新建'
                                }
                              />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Row gutter={16}>
                          <Col xs={24} md={18}>
                            <Form.Item
                              label="描述"
                              name={[field.name, 'description']}
                              rules={[{ required: true, message: '请输入智能体描述' }]}
                            >
                              <Input.TextArea rows={2} placeholder="描述这个智能体的职责和适用场景" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={6}>
                            <Form.Item
                              label="启用状态"
                              name={[field.name, 'enabled']}
                              valuePropName="checked"
                            >
                              <Switch checkedChildren="启用" unCheckedChildren="停用" />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Form.Item
                          label="系统提示词"
                          name={[field.name, 'systemPrompt']}
                          rules={[{ required: true, message: '请输入系统提示词' }]}
                        >
                          <Input.TextArea
                            rows={5}
                            placeholder="请输入系统提示词，用于定义智能体行为。"
                          />
                        </Form.Item>

                        <Card size="small" title="Human-in-the-loop" style={{ marginTop: 16 }}>
                          <Row gutter={16}>
                            <Col xs={24} md={8}>
                              <Form.Item
                                label="启用人工介入"
                                name={[field.name, 'humanInTheLoop', 'enabled']}
                                valuePropName="checked"
                              >
                                <Switch checkedChildren="启用" unCheckedChildren="停用" />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                              <Form.Item
                                label="允许 AskHuman 提问"
                                name={[field.name, 'humanInTheLoop', 'enableAskHuman']}
                                valuePropName="checked"
                              >
                                <Switch checkedChildren="允许" unCheckedChildren="禁止" />
                              </Form.Item>
                            </Col>
                          </Row>
                          {current?.humanInTheLoop?.enabled ? (
                            <Form.Item
                              label="需要审批的工具"
                              name={[field.name, 'humanInTheLoop', 'tools']}
                              extra="可选择内置危险工具，也可以输入其它工具名；为空时使用运行时默认工具。"
                            >
                              <Select
                                mode="tags"
                                allowClear
                                options={HITL_TOOL_OPTIONS}
                                placeholder="选择或输入需要人工审批的工具"
                              />
                            </Form.Item>
                          ) : null}
                        </Card>
                      </Card>
                    );
                  })
                )}
              </>
            )}
          </Form.List>
        </Form>
      </Card>
    </PageContainer>
  );
};

export default AgentsPage;
