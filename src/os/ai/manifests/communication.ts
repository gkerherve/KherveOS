// AI tools of Email and Messages (see ../appManifest.ts for how app tools work).
// The code is in src/apps/email/aiTools.ts and src/apps/messages/aiTools.ts.
// Nothing is ever sent without the user allowing it (ctx.confirm).

import type { AppToolSet } from '../appToolsCore.ts'
import { bool, int, object, str } from './schema.ts'

const ACCOUNT = str('Account email address (default: the account shown in Email).')
const FOLDER = str('Folder: "inbox" (default), "sent", "drafts", "trash", "junk", "archive" or a folder name from email_list_accounts.')
const MESSAGE_ID = str('The message id from email_list_messages or email_search, e.g. "1:4321:INBOX".')

/** The fields of a message being written (compose and send). */
const writing = (bodyNote: string) => ({
  to: str('Recipients, comma separated, e.g. "ann@example.org, Bob <bob@example.org>".'),
  cc: str('Cc recipients, comma separated.'),
  subject: str('The subject.'),
  body: str(`The text of the message (plain text). ${bodyNote}`),
  from: str('Which of the user\'s accounts sends it (email address; default: the one shown).'),
  reply_to: str('Id of a message to answer: fills in its sender, "Re:" subject and threading.'),
})

const CONVERSATION = str('Conversation id, or the name / username of a person or group, e.g. "Ada" or "12".')

export const COMMUNICATION_TOOL_SETS: AppToolSet[] = [
  {
    app: 'email',
    name: 'Email',
    summary: 'the user\'s email (IMAP/SMTP accounts): read the inbox, search, write and send mail.',
    keywords: ['email', 'emails', 'e-mail', 'mail', 'mails', 'inbox', 'mailbox', 'gmail', 'kmail'],
    tools: [
      {
        action: 'list_accounts',
        description: 'List the email accounts set up in Email and their folders, with unread and total counts.',
        inputSchema: object({}),
        readOnly: true,
      },
      {
        action: 'list_messages',
        description: 'List the newest messages of a folder (default: the inbox): id, from, to, subject, date, unread. Use the id with email_read_message.',
        inputSchema: object({
          folder: FOLDER,
          account: ACCOUNT,
          limit: int('How many (default 20, at most 100).'),
          unread_only: bool('Only unread messages (default false).'),
          query: str('Only messages containing these words (subject, sender or text).'),
        }),
        readOnly: true,
      },
      {
        action: 'search',
        description: 'Search a folder (default: the inbox) for messages containing words, in the subject, the addresses or the text. Returns ids, senders, subjects and dates.',
        inputSchema: object({ query: str('Words to look for, e.g. "invoice" or "ann@example.org".'), folder: FOLDER, account: ACCOUNT, limit: int('How many (default 20, at most 100).') }, ['query']),
        readOnly: true,
      },
      {
        action: 'read_message',
        description: 'Read one message: from, to, cc, subject, date, attachments and its text. The server marks it as read.',
        inputSchema: object({ id: MESSAGE_ID }, ['id']),
        readOnly: true,
      },
      {
        action: 'open_message',
        description: 'Show a message in the Email window (opens its folder and selects it), so the user can see it.',
        inputSchema: object({ id: MESSAGE_ID }, ['id']),
      },
      {
        action: 'compose',
        description: 'Open a new message in Email filled in for the user to check, edit and send. It is NOT sent. With reply_to it is a reply.',
        inputSchema: object(writing('With reply_to, the original is quoted below it.')),
      },
      {
        action: 'send',
        description:
          'Send an email (the user is asked to allow it first). Without "to" and "reply_to", sends the message open in the Email compose panel instead.',
        inputSchema: object(writing('Required for a new message.')),
        destructive: false,
      },
    ],
  },
  {
    app: 'messages',
    name: 'Messages',
    summary: 'chat with people on this KherveOS server (direct and group conversations).',
    keywords: ['messages', 'chat', 'chats', 'conversation', 'conversations', 'kchat', 'dm'],
    tools: [
      {
        action: 'list_conversations',
        description: 'List the user\'s Messages conversations, newest first: id, title, members, unread count and the last message.',
        inputSchema: object({ unread_only: bool('Only conversations with unread messages (default false).'), limit: int('How many (default 20).') }),
        readOnly: true,
      },
      {
        action: 'read_conversation',
        description: 'Read the last messages of a conversation (oldest first): who wrote what and when.',
        inputSchema: object({ conversation: CONVERSATION, limit: int('How many of the latest messages (default 20, at most 200).') }, ['conversation']),
        readOnly: true,
      },
      {
        action: 'open_conversation',
        description: 'Show a conversation in the Messages window so the user sees it.',
        inputSchema: object({ conversation: CONVERSATION }, ['conversation']),
      },
      {
        action: 'send',
        description:
          'Send a chat message to a conversation or a person (the user is asked to allow it first). A person with no chat yet gets a new direct conversation.',
        inputSchema: object({ to: CONVERSATION, text: str('The message text (at most 4000 characters).') }, ['to', 'text']),
        destructive: false,
      },
    ],
  },
]
