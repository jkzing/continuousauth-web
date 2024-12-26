import { Project } from '../db/models';

import { Responder } from './Responder';
import { SlackResponder } from './SlackResponder';
import { FeishuResponder } from './FeishuResponder';

export function getResponderFor<Req>(project: Project): Responder<Req> {
  if (project.responder_slack) {
    return new SlackResponder(project) as Responder<Req>;
  }
  if (project.responder_feishu) {
    return new FeishuResponder(project) as Responder<Req>;
  }
  throw new Error(`Attempted to get responder for project ${project.id} but it does not have one`);
}
