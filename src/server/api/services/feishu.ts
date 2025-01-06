import * as express from 'express';
import { Client, EventDispatcher, CardActionHandler, adaptExpress } from '@larksuiteoapi/node-sdk';
import {
  FeishuResponderConfig,
  FeishuResponderLinker,
  Project,
  OTPRequest,
  withTransaction,
} from '../../db/models';
import { FEISHU_OPT_SUBMIT_CALLBACK } from '../../constants';

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
      console.log(data);
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

      // handle /cfa-link command
      // text could be '@_user_1 /cfa-link 686a5157-c100-4b9c-94c2-ce3238ae30c3'
      const REGEX_CFA_LINK = /\/cfa-link\s+(.*)$/i;
      if (content.text && REGEX_CFA_LINK.test(content.text)) {
        const linkerId = REGEX_CFA_LINK.exec(content.text)?.[1];
        if (!linkerId) {
          return respond('Invalid linker ID format. Please return to CFA and try again.');
        }

        try {
          const linker = await FeishuResponderLinker.findByPk(linkerId.trim(), {
            include: [Project],
          });

          if (!linker) {
            return respond(
              'The provided linker ID has been used or does not exist. Please return to CFA and try again.',
            );
          }

          await withTransaction(async (t) => {
            const config = await FeishuResponderConfig.create(
              {
                chatId: chatId,
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
            `Successfully linked this group to project \`${linker.project.repoOwner}/${linker.project.repoName}\``,
          );
        } catch (error) {
          console.error('Error handling cfa-link command:', error);
          return respond('An error occurred while processing the command, please try again later.');
        }
      }
    },
  });

  const cardActionHandler = new CardActionHandler(
    {
      encryptKey: process.env.FEISHU_ENCRYPT_KEY!,
    },
    async (data) => {
      // {
      //   schema: '2.0',
      //   event_id: 'a8e94b247598037c679395467776bdc1',
      //   token: 'c-353909c8c23cd98c83ff7bcf6c3778b694978c81',
      //   create_time: '1735301571334572',
      //   event_type: 'card.action.trigger',
      //   tenant_key: '736588c9260f175d',
      //   app_id: 'cli_a7e7b48b8e69100e',
      //   operator: {
      //     tenant_key: '736588c9260f175d',
      //     open_id: 'ou_957db25bcafe6b6d9c37851c26d1fd23',
      //     union_id: 'on_2875333cf7031b751628aa57a852f176'
      //   },
      //   action: {
      //     value: {
      //       callback: 'otp_submit',
      //       otp: '${otp_token}',
      //       request_id: '5271f798-0127-4bc4-ab30-1a387e72cf66'
      //     },
      //     tag: 'input',
      //     input_value: '233233'
      //   },
      //   host: 'im_message',
      //   context: {
      //     open_message_id: 'om_ff22c60ebebf86d5924e063acb6a045d',
      //     open_chat_id: 'oc_5be033bd2a68c22dc86a6356a5d3e531'
      //   },
      //   [Symbol(event-type)]: 'card.action.trigger'
      // }
      if (data.action?.value?.callback === FEISHU_OPT_SUBMIT_CALLBACK) {
        const requestId = data.action?.value?.request_id;
        if (!requestId) {
          return {
            toast: {
              type: 'error',
              content:
                'CFA experienced an unexpected error while processing your response, please try again later.',
            },
          };
        }
        const otp = data.action?.input_value;
        if (!otp || otp.length !== 6) {
          return {
            toast: {
              type: 'error',
              content: 'CFA received an invalid OTP, please try again.',
            },
          };
        }
        const request: OTPRequest<unknown, any> | null = await OTPRequest.findByPk(requestId);
        if (!request) {
          return {
            toast: {
              type: 'error',
              content:
                'CFA experienced an unexpected error while finding your request, please try again later.',
            },
          };
        }
        if (request.state !== 'validated') {
          return {
            toast: {
              type: 'error',
              content: 'This OTP request is in an invalid state and can not be responded to.',
            },
          };
        }
        if (request.responseMetadata?.messageId === data.context?.open_message_id) {
          // ensure the message is same as the one we sent
          request.state = 'responded';
          request.responded = new Date();
          request.response = otp;
          request.userThatResponded = data.operator.open_id;
          await request.save();
          return {
            toast: {
              type: 'success',
              content: 'CFA received your OTP!',
            },
            card: {
              type: 'raw',
              data: {
                header: {
                  title: {
                    tag: 'plain_text',
                    content: 'CFA OTP Request',
                  },
                  template: 'green',
                },
                elements: [
                  {
                    tag: 'markdown',
                    content: `✅ CFA successfully received OTP token.

The publishing process will now continue automatically.`,
                    text_align: 'left',
                    text_size: 'normal',
                  },
                ],
              },
            },
          };
        } else {
          console.log(data);
          return {
            toast: {
              type: 'error',
              content: 'CFA experienced an unknown error, please try again later.',
            },
          };
        }
      }
    },
  );

  router.use('/events', adaptExpress(eventDispatcher, { autoChallenge: true }));
  router.use('/card', adaptExpress(cardActionHandler, { autoChallenge: true }));

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
