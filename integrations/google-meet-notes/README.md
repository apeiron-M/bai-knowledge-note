# Google Meet notes → Knowledge Vault

`Code.gs` is a Google Apps Script that sends the **Quick notes** tab of every
"Notes by Gemini" doc your Google account can open (your own and those shared
with you) to a Knowledge Vault workflow, which stores each as a source in
`/sources/Meeting notes` and queues it for extraction. It needs no Google Cloud
project and no OAuth setup in the vault: it runs as you, inside Google.

## Setup

1. Open <https://script.google.com> signed in with the company account, create
   a project, and paste `Code.gs` into it.
2. Set `WEBHOOK_URL` and `WEBHOOK_TOKEN` in `CONFIG` (from the vault's
   *Meeting notes* workflow: its webhook address and token).
3. Run `backfill`. Google asks once for permission to read your Drive and
   Docs and to call an external URL. The log reports what was sent; if it says
   some are *left for the next run*, run `backfill` again (Apps Script stops a
   run after 6 minutes).
4. Run `installHourlyTrigger` once. From then on `syncNew` sends new notes
   every hour.

## What it sends

One JSON body per meeting: `id` (the Doc id, the vault's dedupe key), `title`
(without "- Notes by Gemini"), `content` (the Quick notes tab only), `url`,
`author` (the doc's owner) and `meeting_at` (from the title, else the doc's
creation time), with the token in the `x-webhook-token` header.

Repeats are skipped twice over: the script remembers what it sent, and the
vault's *Ingest source* step skips a Doc id it has already stored.
`resetSent` makes the script send everything again; the vault still skips.

## Limits

- A doc without a tab named *Quick notes* is skipped.
- Apps Script quotas: 6 minutes a run, 20,000 URL fetches a day on a consumer
  account (100,000 on Workspace).
- The workflow webhook accepts at most 1 MiB per delivery; a Quick notes tab is
  a few KB.
