# Zoho MCP — Discovered Tool Surface

Probed: 2026-05-09T16:56:38.010Z
Host: molly-leadslandlord-agent-923664408.zohomcp.com
Required handshake: NO (one-shot calls accepted)

Total tools exposed: 34

## sendEmail

**Description:** This API is used to send an email.

**Input schema:**

```json
{
  "type": "object",
  "properties": {
    "body": {
      "properties": {
        "askReceipt": {
          "description": "Specifies whether Read receipt from the recipient is requested or not. Allowed values:- yes - Requesting a read receipt. no - Not requesting a read receipt",
          "enum": [
            "yes",
            "no"
          ],
          "type": "string"
        },
        "attachments": {
          "description": "This paramters is array of attachmes info jsons.",
          "items": {
            "description": "This paramters is array of attachmes info jsons.",
            "properties": {
              "attachmentName": {
                "description": "Specifies the name of the attachment. This parameter can be fetched from Upload Attachments API.",
                "type": "string"
              },
              "attachmentPath": {
                "description": "Specifies the path in which the attachment is stored. This parameter can be fetched from Upload Attachments API.",
                "type": "string"
              },
              "storeName": {
                "description": "Specifies the name of the store where the attachment is saved. This parameter can be fetched from Upload Attachments API.",
                "type": "string"
              }
            },
            "type": "object"
          },
          "type": "array"
        },
        "bccAddress": {
          "description": "Provide the recipient's email address for the Bcc field. Allowed values:- Valid recipient email address for the Bcc field.",
          "type": "string"
        },
        "ccAddress": {
          "description": "Provide the recipient's email address for the Cc field. Allowed values:- Valid recipient email address for the Cc field.",
          "type": "string"
        },
        "content": {
          "description": "Provide the content of the email.",
          "type": "string"
        },
        "encoding": {
          "default": "UTF-8",
          "description": "Specifies the encoding that is to be used in the email content. Allowed values:- Big5, EUC-JP, EUC-KR, GB2312, ISO-2022-JP, ISO-8859-1, KOI8-R, Shift_JIS, US-ASCII, UTF-8, WINDOWS-1251, X-WINDOWS-ISO2022JP. The default value is UTF-8.",
          "enum": [
            "Big5",
            "EUC-JP",
            "EUC-KR",
            "GB2312",
            "ISO-2022-JP",
            "ISO-8859-1",
            "KOI8-R",
            "Shift_JIS",
            "US-ASCII",
            "UTF-8",
            "WINDOWS-1251",
            "X-WINDOWS-ISO2022JP"
          ],
          "type": "string"
        },
        "fromAddress": {
          "description": "Provide the sender's email address (associated to the authenticated account). Allowed values:- Valid email address corresponding to the authenticated account for the From field.",
          "type": "string"
        },
        "isSchedule": {
          "description": "Depending on whether the mail has to be scheduled or not, the value can be true - if the email should be scheduled. false - if the email should be sent immediately.",
          "type": "boolean"
        },
        "mailFormat": {
          "default": "html",
          "description": "Specify the format in which the mail needs to be sent. The value can be html or plaintext. The default value is html.",
          "enum": [
            "html",
            "plaintext"
          ],
          "type": "string"
        },
        "mode": {
          "description": "Specifies whether the content should be saved as a draft or a template. Allowed values: draft, template",
          "enum": [
            "draft",
            "template"
          ],
          "type": "string"
        },
        "scheduleTime": {
          "description": "Specify the date and time you want to schedule your email. This parameter is mandatory if scheduleType is set to value 6. Format:- MM/DD/YYYY HH:MM:SS. For example:- 09/15/2023 14:30:28",
          "type": "string"
        },
        "scheduleType": {
          "description": "Specifies the type of scheduling. Allowed values:- 1 - Schedules email to be sent after one hour from the time of the request. 2 - Schedules email to be sent after two hours from the time of the request. 3 - Schedules email to be sent after four hours from the time of the request. 4 - Schedules email to be sent by the morning of the next day from the time of the request. 5 - Schedules email to be sent by the afternoon of the next day from the time of the request. 6 - Schedules email to be sent on the custom date and time of your choice.",
          "enum": [
            1,
            2,
            3,
            4,
            5,
            6
          ],
          "type": "integer"
        },
        "subject": {
          "description": "Provide the subject of the email.",
          "type": "string"
        },
        "timeZone": {
          "description": "Specify the timezone to schedule your email. This parameter is mandatory if scheduleType is set to value 6. For example:- GMT 5.30 (India Standard Time - Asia/Calcutta).",
          "type": "string"
        },
        "toAddress": {
          "description": "Provide the recipient's email address. Allowed values:- Valid recipient email address for the To field.",
          "type": "string"
        }
      },
      "required": [
        "fromAddress",
        "toAddress"
      ],
      "type": "object"
    },
    "path_variables": {
      "properties": {
        "accountId": {
          "description": "This key is used to identify the account from which the folders have to be fetched. It is generated during account addition.",
          "type": "string"
        }
      },
      "required": [
        "accountId"
      ],
      "type": "object"
    }
  },
  "required": [
    "body",
    "path_variables"
  ]
}
```

## All tools

- `ZohoMail_sendReplyEmail` — This API is used to send a reply to a received email.
- `ZohoMail_markThreadUnread` — This API is used to mark single or multiple threads as unread.
- `ZohoMail_flagMessages` — This API is used to set one of the four flags (info, important, follow-up, flag_not_set) for a particular email or a group of emails.
- `ZohoMail_removeAllLabelFromMessage` — This API is used to remove all labels from a particular email or a group of emails. 
- `ZohoMail_updateSignature` — This API is used to update a specific email signature.
- `ZohoMail_getOriginalMessage` — This API retrieves the MIME representation of an email message.
- `ZohoMail_getMessageAttachmentContent` — The API is used to retrieve the content of the attachments in an email. In case, there are multiple attachments, the user needs to use the api for each attachment with the respective details.
- `ZohoMail_getMessageHeader` — The API retrieves the internet message headers of a particular email, based on the message ID passed as the request parameter.
- `ZohoMail_unSpamMessage` — This API is used to mark a particular email or a group of emails as not spam.
- `ZohoMail_applyFlagToThreads` — This API is used to apply a flag to single or multiple threads.
- `ZohoMail_listEmails` — The API retrieves a list of all the emails in a specific folder or a list of emails based on predefined conditions like status/flags/labels, and more.
- `ZohoMail_markThreadsAsNotSpam` — This API is used to mark single or multiple threads as not spam.
- `ZohoMail_SearchEmails` — Retrieve emails based on Zoho Mail search syntax and parameters.Use the searchKey format {field}:{value}. Combine conditions using :: for AND and :or: for OR.

Examples:
AND search: subject:"Project"::fileContent:summary
Complex search: subject:"Q1 Results"::fileContent:summary::has:attachment
OR search: sender:abc@domain.com:or:to:def@domain.com
Search by attachment content: fileContent:budget
Search by attachment name: fileName:invoice.pdf
Search by cc: cc:test@zohomail.com
Search by content: content:testing
Search by recipient or to: to:def@domain.com
Search by sender or from: sender:abc@domain.com
Search by subject: subject:"Project Update"
Search conversation mails: has:convo
Search entire mail: entire:hello
Search fromDate: fromDate:DD-MMM-YYYY
Search groupResults: groupResult:true
Search in folder: in:folderid
Search ToDate: toDate:DD-MMM-YYYY
Search with attachment: has:attachment
Search with flags: has:flags
Search with includeSpamTrash: inclspamtrash:true
Search with labels: label:labelid
- `ZohoMail_sendEmail` — This API is used to send an email.
- `ZohoMail_markThreadsAsRead` — This API is used to mark single or multiple threads as read.
- `ZohoMail_removeLabelFromMessage` — This API is used to remove a specific labels from a particular email or a group of emails.
- `ZohoMail_unArchiveMessage` — This API is used to unarchive an email or a group of emails.
- `ZohoMail_applyLabelToThreads` — This API is used to apply label to single or multiple threads.
- `ZohoMail_spamMessage` — This API is used to mark a particular email or a group of emails as spam.
- `ZohoMail_addSignature` — This API allows users to add a specific email signature.
- `ZohoMail_removeAllLabelsFromThreads` — This API is used to remove all labels from single or multiple threads.
- `ZohoMail_moveMessages` — This API is used to move a particular email or a group of emails from the existing folder to a new folder.
- `ZohoMail_readMessages` — This API is used to mark single or multiple emails as read.
- `ZohoMail_getMessageContent` — This API is used to retrieve the message contents of an email based on the message ID passed in the request URL. In case, you retrieve an email from a thread, you can add the includeBlockContent parameter to get the reply email and the parent email separately. If block content is available but the includeBlockContent parameter is not passed, then the original email content can only be retrieved.
- `ZohoMail_deleteEmail` — This API is used to delete an email.
- `ZohoMail_removeLabelFromThreads` — This API is used to remove the label(s) from single or multiple threads.
- `ZohoMail_deleteSignature` — This API is used to delete a specific signature for a particular user.
- `ZohoMail_getMessageDetails` — The API retrieves the metadata information of an email based on the message ID passed in the request URL.
- `ZohoMail_applyLabelToMessages` — This API is used to apply labels to a particular email or a group of emails. 
- `ZohoMail_getMessageAttachmentInfo` — The API retrieves the attachment information of a particular email, based on the message ID passed in the request URL.
- `ZohoMail_markThreadSpam` — This API is used to mark single or multiple threads as spam.
- `ZohoMail_archiveMessage` — This API is used to archive an email or a group of emails.
- `ZohoMail_unreadMessage` — This API is used to mark single or multiple emails as unread
- `ZohoMail_moveThreads` — This API is used to move single or multiple threads.
