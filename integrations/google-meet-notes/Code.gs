/**
 * Google Meet "Notes by Gemini" → Knowledge Vault sources.
 *
 * Finds every Google Doc whose title contains "Notes by Gemini" that this
 * account can open (its own and those shared with it), reads only its
 * "Quick notes" tab, and posts it to a Knowledge Vault workflow webhook, which
 * ingests it as a source and queues it for extraction. Oldest meeting first.
 *
 * Setup: see README.md next to this file. In short: set WEBHOOK_URL and
 * WEBHOOK_TOKEN below, run backfill() until it reports nothing left, then run
 * installHourlyTrigger() once.
 */

const CONFIG = {
  // From the vault's Meeting notes workflow: its webhook address and token.
  // Both are required; the script refuses to run until they are set.
  WEBHOOK_URL: '',
  WEBHOOK_TOKEN: '',
  TITLE_MATCH: 'Notes by Gemini',
  TAB_NAME: 'Quick notes',
  // Apps Script stops a run after 6 minutes; stop sending well before that.
  MAX_RUNTIME_MS: 5 * 60 * 1000,
};

/** Send every matching doc not sent yet, oldest meeting first. Run again to continue. */
function backfill() {
  const result = sendPending_();
  Logger.log('Sent %s, skipped %s (already sent or no %s tab), failed %s, left for the next run %s.',
    result.sent, result.skipped, CONFIG.TAB_NAME, result.failed, result.left);
  if (result.unreadable.length) Logger.log('Could not open %s doc(s): %s', result.unreadable.length, result.unreadable.join(' | '));
}

/** What the hourly trigger runs: the same, for docs created since. */
function syncNew() {
  sendPending_();
}

/** Run once after the backfill: checks for new notes every hour. */
function installHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncNew'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncNew').timeBased().everyHours(1).create();
  Logger.log('syncNew now runs every hour.');
}

/** Forget what was sent, so the next backfill() sends everything again (the vault still skips repeats). */
function resetSent() {
  PropertiesService.getUserProperties().deleteAllProperties();
}

function sendPending_() {
  if (!/^https:\/\//.test(CONFIG.WEBHOOK_URL) || !CONFIG.WEBHOOK_TOKEN) {
    throw new Error('Set CONFIG.WEBHOOK_URL (an https:// address) and CONFIG.WEBHOOK_TOKEN first: see README.md.');
  }
  const started = Date.now();
  const props = PropertiesService.getUserProperties();
  const files = [];
  const iterator = DriveApp.searchFiles(
    'mimeType = "application/vnd.google-apps.document" and title contains "' + CONFIG.TITLE_MATCH + '" and trashed = false');
  while (iterator.hasNext()) files.push(iterator.next());
  files.sort(function (a, b) { return meetingTime_(a) - meetingTime_(b); });

  const result = { sent: 0, skipped: 0, failed: 0, left: 0, unreadable: [] };
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (props.getProperty('sent:' + file.getId())) { result.skipped++; continue; }
    if (Date.now() - started > CONFIG.MAX_RUNTIME_MS) { result.left = files.length - i; break; }
    let note;
    try {
      note = readNote_(file);
    } catch (error) {
      // One doc the account cannot open as a Doc (commonly: its owner blocked
      // copying and downloading for viewers) must not stop the run.
      result.failed++;
      result.unreadable.push(file.getName());
      Logger.log('Could not open "%s" (%s): %s', file.getName(), file.getUrl(), error && error.message ? error.message : error);
      continue;
    }
    if (!note) { result.skipped++; continue; }
    const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-webhook-token': CONFIG.WEBHOOK_TOKEN },
      payload: JSON.stringify(note),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      props.setProperty('sent:' + file.getId(), new Date().toISOString());
      result.sent++;
    } else {
      result.failed++;
      Logger.log('%s: the vault answered %s: %s', file.getName(), code, response.getContentText().slice(0, 300));
    }
    Utilities.sleep(300);
  }
  return result;
}

/** The Quick notes tab as plain text, with the meeting's title, time and link. */
function readNote_(file) {
  const doc = DocumentApp.openById(file.getId());
  const tab = findTab_(doc.getTabs(), CONFIG.TAB_NAME);
  if (!tab) return null;
  const content = tab.asDocumentTab().getBody().getText().trim();
  if (!content) return null;
  const owner = file.getOwner();
  return {
    id: file.getId(),
    title: file.getName().replace(/\s*-\s*Notes by Gemini\s*$/i, ''),
    content: content,
    url: file.getUrl(),
    author: owner ? owner.getName() : '',
    meeting_at: new Date(meetingTime_(file)).toISOString(),
  };
}

function findTab_(tabs, name) {
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].getTitle().trim().toLowerCase() === name.toLowerCase()) return tabs[i];
    const child = findTab_(tabs[i].getChildTabs(), name);
    if (child) return child;
  }
  return null;
}

/** The meeting time in the title ("… - 2026/09/11 11:45 GMT-03:00 - Notes by Gemini"), else when the doc was made. */
function meetingTime_(file) {
  const m = file.getName().match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}) GMT([+-]\d{2}):?(\d{2})/);
  if (m) {
    const t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00' + m[6] + ':' + m[7]);
    if (!isNaN(t)) return t;
  }
  return file.getDateCreated().getTime();
}
