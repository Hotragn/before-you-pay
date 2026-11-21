chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'byp:alarm' && msg.remindOn) {
    const when = new Date(msg.remindOn + 'T09:00:00').getTime();
    chrome.alarms.create(`byp|${msg.site}|${msg.remindOn}`, { when: Math.max(when, Date.now() + 60_000) });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const [, site] = alarm.name.split('|');
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'Before You Pay',
    message: `Your ${site} trial turns paid in 2 days. Open your saved offer to see what they promised.`,
  });
});
