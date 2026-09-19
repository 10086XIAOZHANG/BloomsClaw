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
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';

import type { ModelItem } from '../data';
import { createEmptyModel, MODEL_PROVIDER_OPTIONS } from '../data';
import {
  deleteModelItem,
  getBloomsClawModelsConfig,
  saveModelItem,
} from '../service';

type ModelFormValues = {
  models: ModelItem[];
};

const ModelsPage: React.FC = () => {
  const [form] = Form.useForm<ModelFormValues>();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [savingModelId, setSavingModelId] = useState<string>();
  const [deletingModelId, setDeletingModelId] = useState<string>();
  const models = Form.useWatch('models', form) ?? [];

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await getBloomsClawModelsConfig();
      form.setFieldsValue({ models: config.models });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleSave = async (fieldName: number) => {
    const fieldPaths = [
      ['models', fieldName, 'name'],
      ['models', fieldName, 'provider'],
      ['models', fieldName, 'model'],
      ['models', fieldName, 'baseUrl'],
      ['models', fieldName, 'apiKey'],
      ['models', fieldName, 'temperature'],
    ];

    try {
      await form.validateFields(fieldPaths);
      const currentModels = form.getFieldValue('models') ?? [];
      const currentModel = currentModels[fieldName] as ModelItem | undefined;

      if (!currentModel) {
        return;
      }

      const normalizedModel: ModelItem = {
        ...currentModel,
        name: currentModel.name?.trim() ?? '',
        model: currentModel.model?.trim() ?? '',
        baseUrl: currentModel.baseUrl?.trim() ?? '',
        temperature: currentModel.temperature ?? 0.7,
      };

      setSavingModelId(normalizedModel.id || normalizedModel.name);
      const next = await saveModelItem(normalizedModel);
      form.setFieldsValue({ models: next.models });
      message.success(`Model「${normalizedModel.name || '未命名'}」已保存`);
    } finally {
      setSavingModelId(undefined);
    }
  };

  const handleDelete = async (modelName: string) => {
    setDeletingModelId(modelName);
    try {
      const next = await deleteModelItem(modelName);
      form.setFieldsValue({ models: next.models });
      message.success('Model 已删除');
    } finally {
      setDeletingModelId(undefined);
    }
  };

  return (
    <PageContainer title="Models">
      <Card loading={loading}>
        <Form form={form} layout="vertical">
          <Form.List name="models">
            {(fields, { add, remove }) => (
              <>
                <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
                  <Space wrap>
                    <Button
                      icon={<PlusOutlined />}
                      type="primary"
                      onClick={() => add(createEmptyModel())}
                    >
                      新建 Model
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()}>
                      重新加载
                    </Button>
                  </Space>
                </Space>

                {fields.length === 0 ? (
                  <Empty description="暂无模型配置" />
                ) : (
                  fields.map((field, index) => {
                    const current = models[index];
                    const currentKey = current?.name || current?.id;
                    return (
                      <Card
                        key={field.key}
                        title={
                          <Space>
                            <Typography.Text strong>
                              {current?.name || `Model ${index + 1}`}
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
                              loading={Boolean(currentKey && savingModelId === currentKey)}
                              disabled={Boolean(currentKey && deletingModelId === currentKey)}
                              onClick={() => void handleSave(field.name)}
                            >
                              保存配置
                            </Button>
                            {fields.length > 1 ? (
                              <Popconfirm
                                title="确认删除该 Model 吗？"
                                description={
                                  current?.name
                                    ? `删除后将移除「${current.name}」的配置`
                                    : '删除后将移除当前 Model 配置'
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
                                  loading={Boolean(currentKey && deletingModelId === currentKey)}
                                  disabled={Boolean(currentKey && savingModelId === currentKey)}
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
                              label="模型名称"
                              name={[field.name, 'name']}
                              rules={[{ required: true, message: '请输入模型名称' }]}
                            >
                              <Input placeholder="例如：DeepSeek Chat" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="供应商"
                              name={[field.name, 'provider']}
                              rules={[{ required: true, message: '请选择供应商' }]}
                            >
                              <Select
                                options={MODEL_PROVIDER_OPTIONS}
                                placeholder="请选择供应商"
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              label="启用状态"
                              name={[field.name, 'enabled']}
                              valuePropName="checked"
                            >
                              <Switch checkedChildren="启用" unCheckedChildren="停用" />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item
                              label="模型 ID"
                              name={[field.name, 'model']}
                              rules={[{ required: true, message: '请输入模型 ID' }]}
                            >
                              <Input placeholder="例如：deepseek-chat" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item
                              label="Base URL"
                              name={[field.name, 'baseUrl']}
                              rules={[{ required: true, message: '请输入 Base URL' }]}
                            >
                              <Input placeholder="https://api.example.com/v1" />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item
                              label="API Key"
                              name={[field.name, 'apiKey']}
                              rules={[{ required: true, message: '请输入 API Key' }]}
                            >
                              <Input.Password placeholder="请输入 API Key" />
                            </Form.Item>
                            <Form.Item
                              label="从环境变量读取"
                              name={[field.name, 'useEnvApiKey']}
                              valuePropName="checked"
                            >
                              <Switch
                                checkedChildren="开启"
                                unCheckedChildren="关闭"
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item
                              label="Temperature"
                              name={[field.name, 'temperature']}
                              rules={[{ required: true, message: '请输入 temperature' }]}
                            >
                              <InputNumber
                                min={0}
                                max={2}
                                step={0.1}
                                placeholder="默认 0.7"
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
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

export default ModelsPage;
