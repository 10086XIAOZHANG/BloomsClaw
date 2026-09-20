import {
  ApiOutlined,
  ArrowRightOutlined,
  MessageOutlined,
  RobotOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Row, Skeleton, Statistic, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { history } from '@umijs/max';

import './Welcome.css';
import {
  getBloomsClawAgentsConfig,
  getBloomsClawModelsConfig,
  getBloomsClawSkillsConfig,
  getBloomsClawToolsConfig,
} from './agents-config/service';

const { Title, Paragraph, Text } = Typography;

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  index: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, desc, href, index }) => (
  <Col xs={24} sm={12} lg={8}>
    <Card
      hoverable
      className="glass-card stagger-item feature-card"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
      onClick={() => history.push(href)}
      tabIndex={0}
      role="link"
      aria-label={`${title}：${desc}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          history.push(href);
        }
      }}
    >
      <div className="feature-icon" aria-hidden="true">
        {icon}
      </div>
      <Title level={5} className="feature-title">
        {title}
      </Title>
      <Paragraph className="feature-desc">{desc}</Paragraph>
      <span className="feature-link">
        前往管理 <ArrowRightOutlined aria-hidden="true" />
      </span>
    </Card>
  </Col>
);

const STEPS = [
  { no: '01', title: '接入模型', desc: '统一接入 OpenAI、Claude、Gemini 等主流模型，一处配置全局复用。' },
  { no: '02', title: '装配工具与技能', desc: '按需为智能体挂载搜索、代码执行、文件处理等工具与 Skills。' },
  { no: '03', title: '编排并对话', desc: '创建智能体、协同调用，在对话页即时验证效果。' },
];

const Welcome: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ agents: 0, models: 0, tools: 0, skills: 0 });

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const [agents, models, tools, skills] = await Promise.all([
          getBloomsClawAgentsConfig(),
          getBloomsClawModelsConfig(),
          getBloomsClawToolsConfig(),
          getBloomsClawSkillsConfig(),
        ]);
        if (!cancelled) {
          setStats({
            agents: agents.agents.length,
            models: models.models.length,
            tools: tools.tools.length,
            skills: skills.skills.length,
          });
        }
      } catch {
        // 统计加载失败时保持默认值，页面主体仍可访问（skill 规则 network-fallback）
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const features = [
    {
      icon: <RobotOutlined />,
      title: '智能体编排',
      desc: '创建和配置多个 AI 智能体，每个智能体可选择不同的模型和工具。',
      href: '/agents-config/agents',
    },
    {
      icon: <MessageOutlined />,
      title: '智能对话',
      desc: '与智能体进行自然语言对话，获取专业的问题解答和任务协助。',
      href: '/chatbot',
    },
    {
      icon: <ApiOutlined />,
      title: '模型管理',
      desc: '统一管理多种 AI 模型，包括 OpenAI、Claude、Gemini 等主流模型。',
      href: '/agents-config/models',
    },
    {
      icon: <ToolOutlined />,
      title: '工具扩展',
      desc: '支持网页搜索、代码执行、文件处理等多种内置工具。',
      href: '/agents-config/tools',
    },
    {
      icon: <ThunderboltOutlined />,
      title: 'Skills 扩展',
      desc: '为智能体配备丰富技能，让 AI 能力边界无限延伸。',
      href: '/agents-config/skills',
    },
    {
      icon: <SafetyOutlined />,
      title: '安全可控',
      desc: '细粒度的权限控制和对话记录，确保使用安全。',
      href: '/agents-config/agents',
    },
  ];

  const total = stats.agents + stats.models + stats.tools + stats.skills;

  return (
    <main className="welcome-page page-container">
      {/* 1. Hero：产品 + 实时状态 */}
      <section className="hero glass-card" aria-labelledby="welcome-heading">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-body">
          <p className="hero-eyebrow">
            <span className="live-dot" aria-hidden="true" />
            控制台运行中
            <Text type="secondary" className="hero-eyebrow-sub">
              · {total} 项资源已接入
            </Text>
          </p>
          <Title level={1} id="welcome-heading" className="hero-title">
            欢迎使用 <span className="hero-gradient">BloomsClaw</span>
          </Title>
          <Paragraph className="hero-subtitle">
            强大的 AI 智能体编排平台 —— 接入模型、装配工具、编排智能体，一处完成，让 AI 协作更简单。
          </Paragraph>
          <div className="hero-actions">
            <Button
              type="primary"
              size="large"
              className="cta-primary"
              onClick={() => history.push('/chatbot')}
            >
              开始对话 <ArrowRightOutlined aria-hidden="true" />
            </Button>
            <Button size="large" className="cta-ghost" onClick={() => history.push('/agents-config/agents')}>
              配置智能体
            </Button>
          </div>
        </div>

        {/* 2. 关键指标 */}
        <div className="hero-metrics" role="group" aria-label="平台资源统计">
          {loading ? (
            <Skeleton active paragraph={{ rows: 1 }} className="metrics-skeleton" />
          ) : (
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic
                  title="已配置智能体"
                  value={stats.agents}
                  prefix={<RobotOutlined aria-hidden="true" />}
                  valueStyle={{ color: '#F8FAFC' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="可用模型"
                  value={stats.models}
                  prefix={<ApiOutlined aria-hidden="true" />}
                  valueStyle={{ color: '#F8FAFC' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="内置工具"
                  value={stats.tools}
                  prefix={<ToolOutlined aria-hidden="true" />}
                  valueStyle={{ color: '#F8FAFC' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Skills"
                  value={stats.skills}
                  prefix={<ThunderboltOutlined aria-hidden="true" />}
                  valueStyle={{ color: '#F8FAFC' }}
                />
              </Col>
            </Row>
          )}
        </div>
      </section>

      {/* 3. How it works */}
      <section aria-labelledby="how-it-works">
        <Title level={4} id="how-it-works" className="section-title">
          三步上手
        </Title>
        <Row gutter={[16, 16]}>
          {STEPS.map((s, i) => (
            <Col xs={24} sm={12} lg={8} key={s.no}>
              <Card className="glass-card stagger-item step-card" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="step-no" aria-hidden="true">
                  {s.no}
                </span>
                <Title level={5} className="step-title">
                  {s.title}
                </Title>
                <Paragraph className="step-desc">{s.desc}</Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      </section>

      {/* 4. 核心功能 */}
      <section aria-labelledby="core-features">
        <Title level={4} id="core-features" className="section-title">
          核心功能
        </Title>
        <Row gutter={[16, 16]}>
          {features.map((f, i) => (
            <FeatureCard key={f.title} index={i} {...f} />
          ))}
        </Row>
      </section>

      {/* 5. CTA */}
      <section className="cta-band glass-card" aria-labelledby="cta-heading">
        <div>
          <Title level={4} id="cta-heading" className="cta-title">
            准备好编排你的第一个智能体了吗？
          </Title>
          <Paragraph className="cta-desc">从一次对话开始验证，或直接进入控制台完成全套配置。</Paragraph>
        </div>
        <div className="cta-actions">
          <Button type="primary" size="large" className="cta-primary" onClick={() => history.push('/chatbot')}>
            开始对话
          </Button>
          <Button size="large" className="cta-ghost" onClick={() => history.push('/agents-config/agents')}>
            进入控制台
          </Button>
        </div>
      </section>
    </main>
  );
};

export default Welcome;
