let creating, signalReady;
async function ensureOffscreen() {
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return creating;
  creating ??= (async () => {
    let timer;
    const ready = new Promise((resolve, reject) => {
      signalReady = resolve;
      timer = setTimeout(() => reject(new Error('Offscreen inference failed to initialize')), 8000);
    });
    try {
      await Promise.all([ready, chrome.offscreen.createDocument({
        url: 'background.html', reasons: ['WORKERS'], justification: 'Run local inference in a dedicated worker.',
      })]);
    } finally { clearTimeout(timer); signalReady = undefined; }
  })().finally(() => { creating = undefined; });
  await creating;
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.to === 'relay' && sender.tab?.id == null && sender.id === chrome.runtime.id) {
    if (msg.type === 'ready') return void signalReady?.();
    const operation = msg.type === 'inference-started' ? chrome.tabs.sendMessage(msg.tabId, msg.event, { frameId: 0 }) : null;
    if (!operation) return;
    operation.then(reply, () => reply());
    return true;
  }
  if (sender.url === chrome.runtime.getURL('sidebar.html') && msg?.type === 'worker-status') {
    ensureOffscreen().then(() => chrome.runtime.sendMessage({ to: 'offscreen', msg })).then(reply, () => reply());
    return true;
  }
  if (sender.tab?.id == null || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  if (msg?.type === 'panel-settings') return void chrome.runtime.openOptionsPage();
  if (msg?.type === 'badge') {
    void chrome.action.setBadgeText({ tabId, text: msg.paused ? 'OFF' : msg.failed ? '!' : msg.count ? String(msg.count) : '' });
    return;
  }
  if (!['classify', 'worker-status'].includes(msg?.type)) return;
  ensureOffscreen().then(async () => {
    const stored = msg.type === 'classify' ? await chrome.storage.local.get('decisionPrompt') : undefined;
    return chrome.runtime.sendMessage({ to: 'offscreen', msg, tabId, stored });
  }).then(reply, error => reply({ error: `Offscreen dispatch: ${error.message}` }));
  return true;
});
