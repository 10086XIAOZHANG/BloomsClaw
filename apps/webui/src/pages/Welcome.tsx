import {
  ApiOutlined,
  MessageOutlined,
  RobotOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Card, Col, Row, Statistic, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

import './Welcome.css';
import {
  getBloomsClawAgentsConfig,
  getBloomsClawModelsConfig,
  getBloomsClawSkillsConfig,
  getBloomsClawToolsConfig,
} from './agents-config/service';

const { Title, Paragraph } = Typography;

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, desc }) => (
  <Card hoverable className="h-full">
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="text-4xl text-[#1677ff]">{icon}</div>
      <Title level={5} className="m-0">
        {title}
      </Title>
      <Paragraph type="secondary" className="m-0 text-sm">
        {desc}
      </Paragraph>
    </div>
  </Card>
);

const Welcome: React.FC = () => {
  const [agentCount, setAgentCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [toolCount, setToolCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [agents, models, tools, skills] = await Promise.all([
          getBloomsClawAgentsConfig(),
          getBloomsClawModelsConfig(),
          getBloomsClawToolsConfig(),
          getBloomsClawSkillsConfig(),
        ]);
        setAgentCount(agents.agents.length);
        setModelCount(models.models.length);
        setToolCount(tools.tools.length);
        setSkillCount(skills.skills.length);
      } catch {
        // 统计加载失败时保持默认值
      }
    };
    loadStats();
  }, []);

  const features = [
    {
      icon: <RobotOutlined />,
      title: '智能体编排',
      desc: '创建和配置多个 AI 智能体，每个智能体可选择不同的模型和工具',
    },
    {
      icon: <MessageOutlined />,
      title: '智能对话',
      desc: '与智能体进行自然语言对话，获取专业的问题解答和任务协助',
    },
    {
      icon: <ApiOutlined />,
      title: '模型管理',
      desc: '统一管理多种 AI 模型，包括 OpenAI、Claude、Gemini 等主流模型',
    },
    {
      icon: <ToolOutlined />,
      title: '工具扩展',
      desc: '支持网页搜索、代码执行、文件处理等多种内置工具',
    },
    {
      icon: <ThunderboltOutlined />,
      title: '高效协作',
      desc: '智能体之间可相互调用，协同完成复杂任务',
    },
    {
      icon: <SafetyOutlined />,
      title: '安全可控',
      desc: '细粒度的权限控制和对话记录，确保使用安全',
    },
    {
      icon: <ThunderboltOutlined />,
      title: 'Skills 扩展',
      desc: '为智能体配备网页搜索、代码执行、文件处理等丰富技能，让 AI 能力边界无限延伸',
    },
  ];

  return (
    <div className="p-6">
      <Card className="mb-6">
        <div className="mb-8 text-center">
          <Title level={2} className="welcome-gradient-title">
            欢迎使用 BloomsClaw
          </Title>
          <Paragraph type="secondary" className="mx-auto max-w-2xl text-lg">
            强大的 AI 智能体编排平台，让 AI 协作更简单
          </Paragraph>
        </div>

        <Row gutter={[24, 24]} justify="center" className="mb-8">
          <Col xs={24} sm={8}>
            <Statistic
              title="已配置智能体"
              value={agentCount}
              prefix={<RobotOutlined className="text-[#1677ff]" />}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="可用模型"
              value={modelCount}
              prefix={<ApiOutlined className="text-[#52c41a]" />}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="内置工具"
              value={toolCount}
              prefix={<ToolOutlined className="text-[#fa8c16]" />}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="Skills"
              value={skillCount}
              prefix={<ThunderboltOutlined className="text-[#eb2f96]" />}
            />
          </Col>
        </Row>
      </Card>

      <Title level={4} className="mb-4">
        核心功能
      </Title>
      <Row gutter={[16, 16]}>
        {features.map((feature) => (
          <Col xs={24} sm={12} md={8} key={feature.title}>
            <FeatureCard {...feature} />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default Welcome;