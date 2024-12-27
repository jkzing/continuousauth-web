import * as express from 'express';
import { Client, EventDispatcher, adaptExpress } from '@larksuiteoapi/node-sdk';
import {
  FeishuResponderConfig,
  FeishuResponderLinker,
  Project,
  withTransaction,
} from '../../db/models';

declare module 'express-session' {
  interface SessionData {
    feishu?: {
      accessToken: string;
    };
  }
}

export function feishuRoutes() {
  if (
    !process.env.FEISHU_APP_ID ||
    !process.env.FEISHU_APP_SECRET ||
    !process.env.FEISHU_ENCRYPT_KEY
  ) {
    throw new Error('Missing Feishu environment variables');
  }

  const router = express.Router();

  const client = new Client({
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
  });

  const eventDispatcher = new EventDispatcher({
    encryptKey: process.env.FEISHU_ENCRYPT_KEY!,
  }).register({
    'im.message.receive_v1': async (data) => {
      const chatId = data.message.chat_id;
      const content = JSON.parse(data.message.content);
      const respond = (text: string) => {
        return client.im.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text }),
            msg_type: 'text',
          },
        });
      };

      // 处理 /cfa-link 命令
      // text could be '@_user_1 /cfa-link 686a5157-c100-4b9c-94c2-ce3238ae30c3'
      const REGEX_CFA_LINK = /\/cfa-link\s+(.*)$/i;
      if (content.text && REGEX_CFA_LINK.test(content.text)) {
        const linkerId = REGEX_CFA_LINK.exec(content.text)?.[1];
        if (!linkerId) {
          return respond('提供的 linker ID 格式错误，请返回 CFA 重试。');
        }

        try {
          const linker = await FeishuResponderLinker.findByPk(linkerId.trim(), {
            include: [Project],
          });

          if (!linker) {
            return respond('提供的 linker ID 已被使用或不存在，请返回 CFA 重试。');
          }

          await withTransaction(async (t) => {
            const config = await FeishuResponderConfig.create(
              {
                chatId: chatId,
                userToMention: '',
                tenantKey: '',
                appToken: '',
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

          return respond(
            `成功将此群组链接到项目 \`${linker.project.repoOwner}/${linker.project.repoName}\``,
          );
        } catch (error) {
          console.error('Error handling cfa-link command:', error);
          return respond('处理命令时发生错误，请稍后重试。');
        }
      }
    },
  });

  router.use('/events', adaptExpress(eventDispatcher, { autoChallenge: true }));

  router.get('/oauth', async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send('Missing code parameter');
    }

    try {
      // 使用授权码获取用户访问令牌
      const userInfo = await client.authen.accessToken.create({
        data: {
          grant_type: 'authorization_code',
          code: code as string,
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

  return router;
}
