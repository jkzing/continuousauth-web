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

      const messageText = this.getOtpText(request.project, config);
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

  private getOtpText = (project: Project, config: FeishuResponderConfig) =>
    `⚠️ 注意 @${config.userToMention}! CFA 系统需要 2FA OTP token 来发布 ${project.repoOwner}/${project.repoName} 的新版本。`;

  private buildCard(messageText: string, info: RequestInformation | null) {
    const elements = [
      {
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: messageText,
        },
      },
    ];

    if (info) {
      elements.push({
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**请求来源:** [${info.description}](${info.url})`,
        },
      });
    }

    elements.push({
      tag: 'action',
      // @ts-ignore
      actions: [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '输入 OTP Token',
          },
          type: 'danger',
          value: {
            key: 'open_otp_modal',
          },
        },
      ],
    });

    return {
      config: {
        wide_screen_mode: true,
      },
      elements,
    };
  }

  private async notifyError(error: Error) {
    d('Error in Feishu responder:', error);
  }
}