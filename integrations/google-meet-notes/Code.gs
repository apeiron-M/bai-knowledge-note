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
  // Older notes (before Gemini split them into tabs) have no Quick notes tab:
  // send their first tab that is not a transcript instead. false: skip them.
  FALLBACK_TO_NOTES_TAB: true,
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
  const found = [];
  const iterator = DriveApp.searchFiles(
    'mimeType = "application/vnd.google-apps.document" and title contains "' + CONFIG.TITLE_MATCH + '" and trashed = false');
  // Each doc's date is read once: a sort that asked Drive inside its
  // comparison made thousands of calls and ran out of time before sending.
  while (iterator.hasNext()) {
    const file = iterator.next();
    found.push({ file: file, at: meetingTime_(file) });
  }
  found.sort(function (a, b) { return a.at - b.at; });
  const files = found.map(function (f) { return f.file; });
  Logger.log('Found %s doc(s) titled "%s".', files.length, CONFIG.TITLE_MATCH);

  const result = { sent: 0, skipped: 0, failed: 0, left: 0, unreadable: [] };
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (props.getProperty('sent:' + file.getId())) { result.skipped++; continue; }
    if (Date.now() - started > CONFIG.MAX_RUNTIME_MS) { result.left = files.length - i; break; }
    let note;
    Logger.log('%s/%s %s', i + 1, files.length, file.getName());
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
    if (!note) { result.skipped++; Logger.log('  no %s tab%s: skipped', CONFIG.TAB_NAME, CONFIG.FALLBACK_TO_NOTES_TAB ? ' and no notes tab' : ''); continue; }
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
      Logger.log('  sent (%s chars)', note.content.length);
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
  const content = quickNotesText_(file);
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

/**
 * The tab's text, or '' when the doc has no such tab. The Docs API first: it
 * reads anything you can view, including colleagues' docs shared with you,
 * which DocumentApp refuses. Only the text is asked for, not the formatting,
 * so a long Transcript tab stays a small response. DocumentApp is the fallback.
 */
function quickNotesText_(file) {
  const get = function (fields) {
    return UrlFetchApp.fetch(
      'https://docs.googleapis.com/v1/documents/' + file.getId() + '?includeTabsContent=true' +
        (fields ? '&fields=' + encodeURIComponent(fields) : ''),
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  };
  let response = get(TAB_FIELDS_);
  // A field mask the API does not accept is a 400: ask for the whole document instead.
  if (response.getResponseCode() === 400) response = get('');
  if (response.getResponseCode() === 200) {
    const tabs = JSON.parse(response.getContentText()).tabs || [];
    const tab = findApiTab_(tabs, CONFIG.TAB_NAME) || (CONFIG.FALLBACK_TO_NOTES_TAB ? notesTab_(tabs, function (t) { return (t.tabProperties || {}).title || ''; }) : null);
    return tab ? apiTabText_(tab).trim() : '';
  }
  try {
    const tabs = DocumentApp.openById(file.getId()).getTabs();
    const tab = findTab_(tabs, CONFIG.TAB_NAME) || (CONFIG.FALLBACK_TO_NOTES_TAB ? notesTab_(tabs, function (t) { return t.getTitle(); }) : null);
    return tab ? tab.asDocumentTab().getBody().getText().trim() : '';
  } catch (documentAppError) {
    throw new Error('Docs API ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 200) +
      '; DocumentApp: ' + documentAppError.message + whyUnreadable_(file));
  }
}

// Titles and text only, three tab levels deep.
const PARAGRAPH_FIELDS_ = 'paragraph(elements(textRun(content)))';
const TEXT_FIELDS_ = 'documentTab(body(content(' + PARAGRAPH_FIELDS_ + ',table(tableRows(tableCells(content(' + PARAGRAPH_FIELDS_ + ')))))))';
const TAB_FIELDS_ = 'tabs(tabProperties(title),' + TEXT_FIELDS_ + ',childTabs(tabProperties(title),' + TEXT_FIELDS_ +
  ',childTabs(tabProperties(title),' + TEXT_FIELDS_ + ')))';

/** The first top-level tab that is not a transcript: where notes lived before Quick notes. */
function notesTab_(tabs, titleOf) {
  for (let i = 0; i < tabs.length; i++) {
    if (!/transcript/i.test(titleOf(tabs[i]))) return tabs[i];
  }
  return null;
}

/** A Docs API tab by title, children included. */
function findApiTab_(tabs, name) {
  for (let i = 0; i < tabs.length; i++) {
    const title = ((tabs[i].tabProperties || {}).title || '').trim().toLowerCase();
    if (title === name.toLowerCase()) return tabs[i];
    const child = findApiTab_(tabs[i].childTabs || [], name);
    if (child) return child;
  }
  return null;
}

/** Plain text of a Docs API tab: its paragraphs, and those inside tables. */
function apiTabText_(tab) {
  const out = [];
  const walk = function (elements) {
    (elements || []).forEach(function (el) {
      if (el.paragraph) {
        out.push((el.paragraph.elements || []).map(function (e) {
          return e.textRun ? e.textRun.content : '';
        }).join(''));
      } else if (el.table) {
        (el.table.tableRows || []).forEach(function (row) {
          (row.tableCells || []).forEach(function (cell) { walk(cell.content); });
        });
      }
    });
  };
  walk(((tab.documentTab || {}).body || {}).content);
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

/** Why a doc cannot be read, when Drive says: its owner blocked copying and downloading for viewers. */
function whyUnreadable_(file) {
  try {
    const r = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '?fields=copyRequiresWriterPermission,capabilities(canCopy,canDownload)&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    const f = JSON.parse(r.getContentText());
    if (f.copyRequiresWriterPermission || (f.capabilities && f.capabilities.canCopy === false)) {
      return ' (its owner disabled copying and downloading for viewers: ask them to allow it, or to share it with edit access)';
    }
  } catch (e) {
    // the reason stays unknown
  }
  return '';
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
