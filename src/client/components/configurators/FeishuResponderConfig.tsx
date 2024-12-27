import * as React from 'react';
import {
  Button,
  Code,
  Heading,
  ListItem,
  OrderedList,
  Pane,
  Paragraph,
  Spinner,
  TextInput,
  toaster,
} from 'evergreen-ui';

import { FullProject } from '../../../common/types';
import { useAsyncTaskFetch } from 'react-hooks-async';
import { defaultBodyReader } from '../../utils';

export interface Props {
  project: FullProject;
  setProject: (newProject: FullProject) => void;
}

const linkOptions = {
  method: 'POST',
};

export function FeishuResponderConfig({ project, setProject }: Props) {
  const createLinkerTask = useAsyncTaskFetch<{ linker: { id: string }; feishuAppId: string }>(
    `/api/project/${project.id}/config/responders/feishu`,
    linkOptions,
    defaultBodyReader,
  );

  const [chatId, setChatId] = React.useState(
    project.responder_feishu ? project.responder_feishu.chatId : '',
  );
  const [userToMention, setUserToMention] = React.useState(
    project.responder_feishu ? project.responder_feishu.userToMention : '',
  );

  React.useEffect(() => {
    if (!project.responder_feishu && createLinkerTask.start) {
      createLinkerTask.start();
    }
  }, [project.responder_feishu, createLinkerTask.start]);

  const configOptions = React.useMemo(
    () => ({
      method: 'PATCH',
      headers: new Headers({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ chatId, userToMention }),
    }),
    [chatId, userToMention],
  );

  const updateConfigTask = useAsyncTaskFetch<FullProject>(
    `/api/project/${project.id}/config/responders/feishu`,
    configOptions,
    defaultBodyReader,
  );

  React.useEffect(() => {
    if (updateConfigTask.result) {
      setProject(updateConfigTask.result);
      toaster.success('Successfully updated Feishu configuration');
    }
  }, [updateConfigTask.result, setProject]);

  if (project.responder_feishu) {
    return (
      <Pane>
        <Heading size={400} marginBottom={8}>
          Feishu Configuration
        </Heading>
        <Pane marginBottom={16}>
          <TextInput
            width="100%"
            placeholder="Chat ID"
            value={chatId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChatId(e.target.value)}
          />
        </Pane>
        <Pane marginBottom={16}>
          <TextInput
            width="100%"
            placeholder="User ID to mention"
            value={userToMention}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUserToMention(e.target.value)}
          />
        </Pane>
        <Button
          appearance="primary"
          onClick={() => updateConfigTask.start && updateConfigTask.start()}
          isLoading={updateConfigTask.started && updateConfigTask.pending}
        >
          Update Configuration
        </Button>
      </Pane>
    );
  }

  if (createLinkerTask.pending || !createLinkerTask.result) {
    return (
      <Pane>
        <Spinner />
      </Pane>
    );
  }

  return (
    <Pane>
      <Paragraph marginBottom={16}>
        Feishu has not been linked to this Project yet, follow the instructions below to link a
        Feishu chat to this project.
      </Paragraph>
      <OrderedList>
        <ListItem>
          Install the CFA Feishu App in your workspace if it isn't already installed.{' '}
          <a
            style={{
              display: 'block',
              marginTop: 8,
            }}
            href={`https://open.feishu.cn/open-apis/authen/v1/index?app_id=${createLinkerTask.result.feishuAppId}&redirect_uri=${encodeURIComponent(
              `${window.location.origin}/api/services/feishu/oauth`,
            )}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Button appearance="primary" intent="success">
              Add to Feishu
            </Button>
          </a>
        </ListItem>
        <ListItem>
          Run the following command in the chat you want to link:
          <Code>/cfa-link {createLinkerTask.result.linker.id}</Code>
        </ListItem>
        <ListItem>Refresh this project when you're done using the Refresh button above.</ListItem>
      </OrderedList>
    </Pane>
  );
}
