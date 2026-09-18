import {
  DeleteOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';

import type { SkillItem } from '../data';
import {
  deleteSkillItem,
  getImoocClawSkillsConfig,
  installSkillByCommand,
  saveSkillItem,
} from '../service';

const SkillsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [savingSkillId, setSavingSkillId] = useState<string>();
  const [deletingSkillId, setDeletingSkillId] = useState<string>();
  const [installCommand, setInstallCommand] = useState('');
  const [skills, setSkills] = useState<SkillItem[]>([]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await getImoocClawSkillsConfig();
      setSkills(config.skills);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleInstall = async () => {
    const command = installCommand.trim();
    if (!command) {
      message.warning('请输入从 skills.sh 复制的安装命令');
      return;
    }

    setInstalling(true);
    try {
      const next = await installSkillByCommand(command);
      setSkills(next.skills);
      setInstallCommand('');
      message.success('Skill 安装完成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Skill 安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (skillId: string, checked: boolean) => {
    const previousSkills = skills;
    const nextSkills = skills.map((item) =>
      item.id === skillId ? { ...item, enabled: checked } : item,
    );
    const currentSkill = nextSkills.find((item) => item.id === skillId);

    setSkills(nextSkills);
    setSavingSkillId(skillId);

    try {
      if (!currentSkill) {
        return;
      }

      const next = await saveSkillItem(currentSkill);
      setSkills(next.skills);
    } catch (error) {
      setSkills(previousSkills);
      message.error(error instanceof Error ? error.message : 'Skill 状态保存失败');
    } finally {
      setSavingSkillId(undefined);
    }
  };

  const handleDelete = async (skillId: string) => {
    setDeletingSkillId(skillId);
    try {
      const next = await deleteSkillItem(skillId);
      setSkills(next.skills);
      message.success('Skill 已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Skill 删除失败');
    } finally {
      setDeletingSkillId(undefined);
    }
  };

  return (
    <PageContainer title="Skills">
      <Card loading={loading}>
        <Space
          direction="vertical"
          size={16}
          style={{ width: '100%', marginBottom: 24 }}
        >
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            粘贴 skills.sh 提供的 `npx skills add ...` 安装命令，系统会自动下载并纳管到本地 Skills 仓库。
          </Typography.Paragraph>
          <Input.TextArea
            rows={3}
            value={installCommand}
            onChange={(event) => setInstallCommand(event.target.value)}
            placeholder='例如：npx skills add vercel-labs/agent-skills --skill frontend-design'
          />
          <Space wrap>
            <Button
              type="primary"
              icon={<ImportOutlined />}
              loading={installing}
              onClick={() => void handleInstall()}
            >
              安装 Skill
            </Button>
          </Space>
        </Space>

        {skills.length === 0 ? (
          <Empty description="暂无 Skill，可先通过安装命令导入" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {skills.map((skill) => (
              <Card
                key={skill.id}
                title={
                  <Space wrap>
                    <Typography.Text strong>{skill.name}</Typography.Text>
                    <Tag color={skill.enabled ? 'green' : 'default'}>
                      {skill.enabled ? '已启用' : '已停用'}
                    </Tag>
                  </Space>
                }
                extra={
                  <Space wrap>
                    <Switch
                      checked={skill.enabled}
                      loading={savingSkillId === skill.id}
                      disabled={Boolean(deletingSkillId === skill.id)}
                      checkedChildren="启用"
                      unCheckedChildren="停用"
                      onChange={(checked) => void handleToggle(skill.id, checked)}
                    />
                    <Popconfirm
                      title="确认删除该 Skill 吗？"
                      description={`删除后将移除「${skill.name}」的本地安装内容`}
                      okText="确认删除"
                      cancelText="取消"
                      onConfirm={() => handleDelete(skill.id)}
                    >
                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        loading={deletingSkillId === skill.id}
                        disabled={Boolean(savingSkillId === skill.id)}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                }
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {skill.description || '暂无描述'}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary">
                    来源：{skill.source || '未知来源'}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    安装时间：
                    {skill.installedAt
                      ? dayjs(skill.installedAt).format('YYYY-MM-DD HH:mm:ss')
                      : '未知'}
                  </Typography.Text>
                  <Typography.Paragraph
                    copyable={Boolean(skill.installCommand)}
                    code
                    style={{ marginBottom: 0 }}
                  >
                    {skill.installCommand || '未记录安装命令'}
                  </Typography.Paragraph>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Card>
    </PageContainer>
  );
};

export default SkillsPage;
