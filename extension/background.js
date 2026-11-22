chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Alarms can be cleared when Chrome restarts, so reminders are also kept in
// chrome.storage and recreated on startup.
async function schedule(r) {
  const when = new Date(r.remindOn + 'T09:00:00').getTime();
  if (r.remindOn < today()) return;
  chrome.alarms.create(`byp|${r.site}|${r.remindOn}`, { when: Math.max(when, Date.now() + 60_000) });
}

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

// Keep only reminders that have not happened yet, one per site and day.
async function upcoming(extra) {
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  const all = extra ? [...reminders, extra] : reminders;
  const keep = all.filter((r, i) => r.remindOn >= today()
    && all.findIndex((o) => o.site === r.site && o.remindOn === r.remindOn) === i);
  await chrome.storage.local.set({ reminders: keep });
  return keep;
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== 'byp:alarm') return;
  await upcoming({ site: msg.site, remindOn: msg.remindOn });
  schedule(msg);
});

chrome.runtime.onStartup.addListener(async () => {
  (await upcoming()).forEach(schedule);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const [, site, day] = alarm.name.split('|');
  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'Before You Pay',
    message: `Your ${site} plan starts charging soon (reminder for ${day}). Click to open the site and check your plan.`,
  });
});

// The reminder opens the site the offer came from, where the plan can be cancelled.
chrome.notifications.onClicked.addListener((id) => {
  const site = id.split('|')[1];
  if (/^[a-z0-9.-]+$/i.test(site || '')) chrome.tabs.create({ url: `https://${site}/` });
});
