import * as debug from 'debug';
import { Client } from '@larksuiteoapi/node-sdk';
import { Responder, RequestInformation } from './Responder';
import { FeishuResponderConfig, OTPRequest, Project } from '../db/models';

const d = debug('cfa:responder:feishu');

type FeishuResponderMetadata = {
  messageId: string;
};

export class FeishuResponder extends Responder<unknown, FeishuResponderMetadata> {
  private client: Client;

  constructor(project: Project) {
    super(project);
    this.client = new Client({
      appId: process.env.FEISHU_APP_ID!,
      appSecret: process.env.FEISHU_APP_SECRET!,
    });
  }

  async requestOtp(
    request: OTPRequest<unknown, FeishuResponderMetadata>,
    info: RequestInformation | null,
  ) {
    try {
      const config = this.project.responder_feishu;
      if (!config) return;

      const messageText = this.getOtpText(request.project);
      const card = this.buildCard(messageText, info);

      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: config.chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to send message: ${response.msg}`);
      }

      request.responseMetadata = {
        messageId: response.data?.message_id ?? '',
      };
      await request.save();
    } catch (err) {
      d('Failed to send OTP request:', err);
      await this.notifyError(err as Error);
    }
  }

  private getOtpText = (project: Project) =>
    // `⚠️ 注意! CFA 系统需要 2FA OTP token 来发布 ${project.repoOwner}/${project.repoName} 的新版本。`;
    `🚧 Attention on deck! The CFA system needs a 2FA OTP token to publish a new release of ${project.repoOwner}/${project.repoName}. （已编辑） \nThe request source is linked below\n> TODO\nThis request has been validated by CFA and now just requires a OTP code.`;

  private buildCard(messageText: string, info: RequestInformation | null) {
    // if (info) {
    //   elements.push({
    //     tag: 'div',
    //     text: {
    //       tag: 'lark_md',
    //       content: `**Request source:** [${info.description}](${info.url})`,
    //     },
    //   });
    // }

    return {
      config: {
        update_multi: true,
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: 'CFA OTP Request',
        },
        template: 'yellow',
      },
      elements: [
        {
          tag: 'markdown',
          content: messageText,
          text_align: 'left',
          text_size: 'normal',
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'input',
              placeholder: {
                tag: 'plain_text',
                content: 'Enter OTP here',
              },
              default_value: '',
              width: 'default',
            },
          ],
          fallback: {
            tag: 'fallback_text',
            text: {
              tag: 'plain_text',
              content: '仅支持在飞书 V6.8 及以上版本使用',
            },
          },
        },
      ],
    };
  }

  private async notifyError(error: Error) {
    d('Error in Feishu responder:', error);
  }
}
