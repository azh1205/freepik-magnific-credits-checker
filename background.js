// =========================
// CONFIG
// =========================

const MAGNIFIC_LOGIN_URL = "https://www.magnific.com/login";
const MAGNIFIC_SUBSCRIPTION_URL = "https://www.magnific.com/user/my-subscriptions";


// =========================
// INSTALL
// =========================

chrome.runtime.onInstalled.addListener(() => {
  console.log("Credit Dashboard installed");

  chrome.alarms.create("refreshAccountsAlarm", {
    periodInMinutes: 60
  });
});


// =========================
// MESSAGE LISTENER
// =========================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "addAccount") {
    addAccount();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "refreshAccounts") {
    refreshAllAccounts().then(() => {
      sendResponse({ success: true });
    });

    return true;
  }
  if (message.action === "reconnectAccount") {
  reconnectAccount(message.index).then(() => {
    sendResponse({ success: true });
  });

  return true;
}
  if (message.action === "removeAccount") {
    removeAccount(message.index).then(() => {
      sendResponse({ success: true });
    });

    return true;
  }
if (message.action === "importBackup") {
  importBackup(message.accounts).then((count) => {
    sendResponse({
      success: true,
      count
    });
  });

  return true;
}
});

// =========================
// ADD ACCOUNT
// =========================

async function clearMagnificCookies() {
  const allCookies = await chrome.cookies.getAll({});

  const magnificCookies = allCookies.filter(cookie => {
    return cookie.domain.includes("magnific.com");
  });

  for (const cookie of magnificCookies) {
    const cleanDomain = cookie.domain.startsWith(".")
      ? cookie.domain.substring(1)
      : cookie.domain;

    const url = `${cookie.secure ? "https" : "http"}://${cleanDomain}${cookie.path}`;

    await chrome.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.storeId
    });
  }

  console.log("Cleared Magnific cookies:", magnificCookies.length);
}

async function addAccount() {
  await clearMagnificCookies();

  chrome.windows.create({
    url: "https://www.magnific.com/logout",
    type: "popup",
    width: 1200,
    height: 900
  });

  setTimeout(() => {
    chrome.windows.create({
      url: MAGNIFIC_LOGIN_URL,
      type: "popup",
      width: 1200,
      height: 900
    });
  }, 2000);
}

async function removeAccount(index) {
  const data = await chrome.storage.local.get(["accounts"]);
  const accounts = data.accounts || [];

  accounts.splice(index, 1);

  await chrome.storage.local.set({ accounts });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function reconnectAccount(index) {
  const data = await chrome.storage.local.get(["accounts"]);
  const accounts = data.accounts || [];

  const account = accounts[index];

  if (!account) return;

  account.refreshStatus = "reconnecting";
  account.refreshError = "Please login again in the opened window.";

  await chrome.storage.local.set({ accounts });

  await clearMagnificCookies();

  chrome.windows.create({
    url: MAGNIFIC_LOGIN_URL,
    type: "popup",
    width: 1200,
    height: 900
  });
}

async function importBackup(importedAccounts) {
  const data = await chrome.storage.local.get(["accounts"]);
  const existingAccounts = data.accounts || [];

  let importedCount = 0;

  for (const imported of importedAccounts) {
    if (!imported.email || !imported.provider || !imported.cookies) {
      continue;
    }

    const existingIndex = existingAccounts.findIndex(account => {
      return (
        account.provider === imported.provider &&
        account.email === imported.email
      );
    });

    const cleanedAccount = {
      ...imported,
      refreshStatus: imported.refreshStatus || "imported",
      refreshError: "",
      importedAt: new Date().toISOString()
    };

    if (!cleanedAccount.addedOrder) {
      cleanedAccount.addedOrder = Date.now() + importedCount;
    }

    if (existingIndex >= 0) {
      existingAccounts[existingIndex] = {
        ...existingAccounts[existingIndex],
        ...cleanedAccount
      };
    } else {
      existingAccounts.push(cleanedAccount);
    }

    importedCount++;
  }

  await chrome.storage.local.set({
    accounts: existingAccounts
  });

  return importedCount;
}

// =========================
// DETECT SUCCESSFUL LOGIN
// =========================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;

  const isMagnificSubscriptionPage =
    tab.url.startsWith(MAGNIFIC_SUBSCRIPTION_URL);

  if (!isMagnificSubscriptionPage) return;

  console.log("Magnific subscription page detected");

  await saveMagnificAccount(tabId);
});


// =========================
// SAVE MAGNIFIC ACCOUNT
// =========================

async function saveMagnificAccount(tabId) {
  try {
    const cookies = await chrome.cookies.getAll({
      domain: "www.magnific.com"
    });

    const rootCookies = await chrome.cookies.getAll({
      domain: ".magnific.com"
    });

    const allCookies = [...cookies, ...rootCookies];

    if (allCookies.length === 0) {
      console.warn("No Magnific cookies found");
      return;
    }

    const pageData = await readMagnificPageData(tabId);

    const account = {
  id: createAccountId(),
  addedOrder: Date.now(),
  provider: "magnific",

  email: pageData.email || "Magnific Account",

  credits: pageData.credits || "Unknown",
  spent: pageData.spent || "Unknown",

  status: pageData.status || "Saved",

  cookies: allCookies,

  sessionSavedAt: new Date().toISOString(),

  refreshStatus: "success",
  refreshError: "",

  lastUpdated: new Date().toLocaleString()
};

    await upsertAccount(account);

    console.log("Magnific account saved", account);

  } catch (error) {
    console.error("Failed to save Magnific account", error);
  }
}


// =========================
// READ DATA FROM PAGE
// =========================

async function readMagnificPageData(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const bodyText = document.body.innerText;

      let credits = "Unknown";
      let spent = "Unknown";
      let status = "Active";
      let email = "Magnific Account";

      // Credits
      const availableMatch = bodyText.match(/Available:\s*([\d.,]+[KMB]?)/i);
      if (availableMatch) {
        credits = availableMatch[1];
      }

      const spentMatch = bodyText.match(/Spent\s*([\d.,]+[KMB]?)/i);
      if (spentMatch) {
        spent = spentMatch[1];
      }

      // Status
      if (/Canceled|Cancelled/i.test(bodyText)) {
        status = "Canceled";
      } else if (/Expired|Inactive/i.test(bodyText)) {
        status = "Inactive";
      } else if (/Active until/i.test(bodyText)) {
        status = "Active";
      }

      // Billing email only, avoid support@magnific.com
      const billingSectionMatch = bodyText.match(
        /Billing information([\s\S]*?)Payment details/i
      );

      if (billingSectionMatch) {
        const billingText = billingSectionMatch[1];

        const emailMatch = billingText.match(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
        );

        if (emailMatch) {
          email = emailMatch[0];
        }
      }

      return {
        email,
        credits,
        spent,
        status,
        debugText: bodyText
      };
    }
  });

  return results?.[0]?.result || {};
}

// =========================
// UPSERT ACCOUNT
// =========================

async function upsertAccount(newAccount) {
  const data = await chrome.storage.local.get(["accounts"]);
  const accounts = data.accounts || [];

  const existingIndex = accounts.findIndex((account) => {
    return (
      account.provider === newAccount.provider &&
      account.email === newAccount.email
    );
  });

  if (existingIndex >= 0) {
    accounts[existingIndex] = {
      ...accounts[existingIndex],
      ...newAccount
    };
  } else {
    accounts.push(newAccount);
  }

  await chrome.storage.local.set({ accounts });
}


// =========================
// REFRESH ALL ACCOUNTS
// =========================

async function refreshAllAccounts() {
  const data = await chrome.storage.local.get(["accounts"]);
  const accounts = data.accounts || [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    try {
      account.refreshStatus = "refreshing";
      account.refreshError = "";
      await chrome.storage.local.set({ accounts });

      // Delay before each account except the first one
      if (i > 0) {
        const delayMs = getRandomDelay(15000, 45000);
        await sleep(delayMs);
      }

      if (!account.cookies || account.cookies.length === 0) {

  account.refreshStatus = "expired";
  account.refreshError = "Missing cookies. Please re-login.";

  throw new Error(account.refreshError);
}

      account.refreshStatus = "success";
      account.refreshError = "";
      account.lastUpdated = new Date().toLocaleString();

    } catch (error) {
      account.refreshStatus = "failed";
      account.refreshError = error.message || "Refresh failed";
    }

    await chrome.storage.local.set({ accounts });
  }
}


// =========================
// AUTO REFRESH
// =========================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshAccountsAlarm") {
    refreshAllAccounts();
  }
});


// =========================
// HELPERS
// =========================

function createAccountId() {
  return `account_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}