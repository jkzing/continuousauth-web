import * as express from 'express';
import { Client } from '@larksuiteoapi/node-sdk';
import { FeishuResponderConfig, FeishuResponderLinker, Project, withTransaction } from '../../db/models';

declare module 'express-session' {
  interface SessionData {
    feishu?: {
      accessToken: string;
    };
  }
}

export function feishuRoutes() {
  const router = express();

  router.get('/oauth', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Missing code parameter');
    }

    const client = new Client({
      appId: process.env.FEISHU_APP_ID!,
      appSecret: process.env.FEISHU_APP_SECRET!,
    });

    try {
      // 使用授权码获取用户访问令牌
      const userInfo = await client.authen.accessToken.create({
        data: {
          grant_type: 'authorization_code',
          code: code as string
        },
      });

      if (userInfo.code !== 0) {
        throw new Error(`Failed to get user access token: ${userInfo.msg}`);
      }

      // 存储租户信息和令牌
      const accessToken = userInfo.data?.access_token;

      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      // 将令牌信息存储到 session 中，供后续使用
      if (req.session) {
        req.session.feishu = {
          accessToken,
        };
      }

      res.redirect('/projects');
    } catch (error) {
      console.error('Error during Feishu OAuth:', error);
      res.status(500).send('Failed to complete OAuth flow');
    }
  });

  // 处理飞书机器人命令
  router.post('/command', async (req, res) => {
    const { token, text, user_id, chat_id } = req.body;

    // 验证请求是否来自飞书
    if (token !== process.env.FEISHU_VERIFICATION_TOKEN) {
      return res.status(401).json({ error: 'Invalid verification token' });
    }

    // 处理 /cfa-link 命令
    if (text.startsWith('/cfa-link')) {
      const linkerId = text.split(' ')[1];
      if (!linkerId) {
        return res.json({
          text: '缺少必要的参数 "link-id"，请确保您按照 CFA 上的说明正确操作。',
        });
      }

      try {
        const linker = await FeishuResponderLinker.findByPk(linkerId, {
          include: [Project],
        });

        if (!linker) {
          return res.json({
            text: '提供的 linker ID 已被使用或不存在，请返回 CFA 重试。',
          });
        }

        await withTransaction(async (t) => {
          const config = await FeishuResponderConfig.create(
            {
              chatId: chat_id,
              userToMention: user_id,
              tenantKey: '',
              appToken: req.session?.feishu?.accessToken || '',
            },
            {
              transaction: t,
              returning: true,
            },
          );

          await linker.project.resetAllResponders(t);
          linker.project.responder_feishu_id = config.id;
          await linker.project.save({ transaction: t });
          await linker.destroy({ transaction: t });
        });

        return res.json({
          text: `成功将此群组链接到项目 \`${linker.project.repoOwner}/${linker.project.repoName}\``,
        });
      } catch (error) {
        console.error('Error handling cfa-link command:', error);
        return res.json({
          text: '处理命令时发生错误，请稍后重试。',
        });
      }
    }

    res.json({ text: '未知命令' });
  });

  return router;
}
