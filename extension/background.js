const APP = 'https://before-you-pay-9b8c6.web.app/';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Alarms can be cleared when Chrome restarts, so reminders are also kept in
// chrome.storage and recreated on startup.
async function schedule(r) {
  const when = new Date(r.remindOn + 'T09:00:00').getTime();
  if (when < Date.now() - 24 * 3600 * 1000) return;
  chrome.alarms.create(`byp|${r.site}|${r.remindOn}`, { when: Math.max(when, Date.now() + 60_000) });
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== 'byp:alarm') return;
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  reminders.push({ site: msg.site, remindOn: msg.remindOn });
  await chrome.storage.local.set({ reminders });
  schedule(msg);
});

chrome.runtime.onStartup.addListener(async () => {
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  reminders.forEach(schedule);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const [, site, day] = alarm.name.split('|');
  chrome.notifications.create(alarm.name, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'Before You Pay',
    message: `Your ${site} plan starts charging soon (reminder for ${day}). Open your saved offer to see what they promised.`,
  });
});

chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: APP }));
