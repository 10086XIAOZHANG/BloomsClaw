import { PageContainer } from '@ant-design/pro-components';
import {
  App,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

import type { ToolItem } from '../data';
import { getBloomsClawToolsConfig, saveToolItem } from '../service';

const ToolsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [savingToolId, setSavingToolId] = useState<string>();
  const [tools, setTools] = useState<ToolItem[]>([]);

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
        </Space>

        {tools.length === 0 ? (
          <Empty description="暂无工具配置" />
        ) : (
          <Row gutter={[16, 16]}>
            {tools.map((tool, index) => (
              <Col key={tool.id} xs={24} md={12} xl={8}>
                <Card
                  title={
                    <Space>
                      <Typography.Text strong>
                        {tool.name || `Tool ${index + 1}`}
                      </Typography.Text>
                      <Tag color="blue">内置</Tag>
                    </Space>
                  }
                  extra={
                    <Switch
                      checked={tool.enabled}
                      loading={savingToolId === tool.id}
                      disabled={savingToolId === tool.id}
                      checkedChildren="启用"
                      unCheckedChildren="停用"
                      onChange={(checked) => void handleToggle(tool.id, checked)}
                    />
                  }
                  style={{ height: '100%' }}
                >
                  <Typography.Paragraph style={{ minHeight: 44 }}>
                    {tool.description}
                  </Typography.Paragraph>

                  <Space wrap>
                    <Tag color={tool.enabled ? 'green' : 'default'}>
                      {tool.enabled ? '已启用' : '已停用'}
                    </Tag>
                    <Tag color={tool.builtin ? 'blue' : 'default'}>
                      {tool.builtin ? '内置' : '自定义'}
                    </Tag>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </PageContainer>
  );
};

export default ToolsPage;
