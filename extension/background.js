// Adobe Web Usage Sensor (Multi-Tenant) v3
// Tracks Adobe web application usage and reports to SubTracker API

const REPORT_URL_DEFAULT = "http://localhost:3000/api/track";

const ADOBE_APP_HOSTS = [
  "adobe.com",
  "www.adobe.com",
  "assets.adobe.com",
  "express.adobe.com",
  "acrobat.adobe.com",
  "adminconsole.adobe.com",
  "spark.adobe.com",
  "creative.adobe.com"
];

const SUPPRESS_MS = 60_000; // Suppress duplicate fires for 1 minute per tab+host
const recentFires = new Map();

function log(...args) {
  console.log("[AdobeSensor]", ...args);
}

// Load configuration (API URL, API Key, Client ID)
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiUrl", "apiKey", "clientId"], (res) => {
      // Generate client ID if not exists
      if (!res.clientId) {
        const id = crypto.randomUUID();
        chrome.storage.local.set({ clientId: id });
        res.clientId = id;
      }
      
      resolve({
        apiUrl: res.apiUrl || REPORT_URL_DEFAULT,
        apiKey: res.apiKey || null,
        clientId: res.clientId
      });
    });
  });
}

// Check if we should fire for this tab+host combo
function shouldFire(tabId, host) {
  const key = `${tabId}|${host}`;
  const now = Date.now();
  const last = recentFires.get(key) || 0;
  if (now - last < SUPPRESS_MS) return false;
  recentFires.set(key, now);
  return true;
}

// Post usage event to API
async function postUsage({ url, tabId, why }) {
  try {
    const { apiUrl, apiKey, clientId } = await getConfig();
    
    // Check if API key is configured
    if (!apiKey) {
      log("⚠️  No API key configured. Please configure extension.");
      return;
    }
    
    const payload = {
      event: "adobe_web_login_detected",
      url,
      tabId,
      clientId,
      why,
      when: new Date().toISOString()
    };
    
    log("POST", { url: payload.url, tabId, why });
    
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey  // Multi-tenant API key auth
      },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      log("✓ POST success", res.status);
    } else {
      log("✗ POST failed", res.status, await res.text());
    }
  } catch (e) {
    log("✗ POST error:", String(e));
  }
}

// Check if hostname is an Adobe app
function isAdobeAppHost(hostname) {
  return ADOBE_APP_HOSTS.some(h => hostname === h || hostname.endsWith("." + h));
}

// Consider firing usage event
function consider(details, why) {
  try {
    const url = new URL(details.url);
    if (details.frameId !== 0) return; // Main frame only
    
    if (isAdobeAppHost(url.hostname)) {
      if (shouldFire(details.tabId, url.hostname)) {
        postUsage({ url: details.url, tabId: details.tabId, why });
      } else {
        log("Suppressed duplicate", details.tabId, url.hostname, why);
      }
    }
  } catch (e) {
    log("consider() error", e);
  }
}

// Navigation hooks - cover SPAs and normal navigations
chrome.webNavigation.onCompleted.addListener(
  (d) => consider(d, "onCompleted"), 
  { url: [{ hostSuffix: "adobe.com" }] }
);

chrome.webNavigation.onCommitted.addListener(
  (d) => consider(d, "onCommitted"), 
  { url: [{ hostSuffix: "adobe.com" }] }
);

chrome.webNavigation.onDOMContentLoaded.addListener(
  (d) => consider(d, "onDOMContentLoaded"), 
  { url: [{ hostSuffix: "adobe.com" }] }
);

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (d) => consider(d, "onHistoryStateUpdated"), 
  { url: [{ hostSuffix: "adobe.com" }] }
);

// Installation handler
chrome.runtime.onInstalled.addListener(async () => {
  log("Service worker installed");
  
  const { apiKey, apiUrl } = await getConfig();
  
  if (!apiKey) {
    log("⚠️  API key not configured!");
    log("To configure, right-click extension icon → Options");
  } else {
    log("✓ API key configured");
    log("✓ API URL:", apiUrl);
  }
});

// Action click opens options page
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Test connection on startup (if configured)
chrome.runtime.onStartup.addListener(async () => {
  const { apiKey, apiUrl } = await getConfig();
  
  if (apiKey) {
    log("Testing API connection...");
    try {
      const res = await fetch(apiUrl.replace("/api/track", "/api/health"));
      if (res.ok) {
        log("✓ API connection successful");
      } else {
        log("✗ API connection failed", res.status);
      }
    } catch (e) {
      log("✗ Cannot reach API:", String(e));
    }
  }
});
