const addAccountBtn = document.getElementById("addAccountBtn");
const refreshBtn = document.getElementById("refreshBtn");
const accountsList = document.getElementById("accountsList");
const statusText = document.getElementById("statusText");
const exportBtn = document.getElementById("exportBtn");
const searchInput = document.getElementById("searchInput");
const refreshQueue = document.getElementById("refreshQueue");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

let currentAccounts = [];

importBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "Importing backup may restore login sessions/cookies. Only import files you trust."
  );

  if (!confirmed) return;

  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.accounts || !Array.isArray(backup.accounts)) {
      throw new Error("Invalid backup file");
    }

    chrome.runtime.sendMessage({
      action: "importBackup",
      accounts: backup.accounts
    }, (response) => {
      if (response && response.success) {
        statusText.innerText = `Imported ${response.count} accounts`;
        loadAccounts();
      } else {
        statusText.innerText = "Import failed";
      }
    });

  } catch (error) {
    statusText.innerText = error.message || "Import failed";
  }

  importFile.value = "";
});


searchInput.addEventListener("input", () => {
  renderAccounts(getFilteredAccounts());
});

function getFilteredAccounts() {
  const query = searchInput.value.trim().toLowerCase();

  if (!query) return currentAccounts;

  return currentAccounts.filter(account => {
    return (
      String(account.email || "").toLowerCase().includes(query) ||
      String(account.provider || "").toLowerCase().includes(query) ||
      String(account.status || "").toLowerCase().includes(query)
    );
  });
}

function updateRefreshQueue(accounts) {
  const refreshingIndex = accounts.findIndex(
    acc => acc.refreshStatus === "refreshing"
  );

  if (refreshingIndex === -1) {
    refreshQueue.innerText = "";
    return;
  }

  refreshQueue.innerText =
    `Refreshing ${refreshingIndex + 1} / ${accounts.length}`;
}

exportBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "Export contains login cookies/sessions. Keep it private. Continue?"
  );

  if (!confirmed) return;

  chrome.storage.local.get(["accounts"], (result) => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      warning: "This file contains login cookies/sessions. Keep it private.",
      accounts: result.accounts || []
    };

    const blob = new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `credit-dashboard-backup-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  });
});

// =========================
// LOAD ACCOUNTS
// =========================

loadAccounts();

async function loadAccounts() {

  chrome.storage.local.get(["accounts"], (result) => {

    const accounts = result.accounts || [];

    accounts.sort((a, b) => {
  return (a.addedOrder || 0) - (b.addedOrder || 0);
});

currentAccounts = accounts;
    updateRefreshQueue(accounts);
    renderAccounts(getFilteredAccounts());

  });

}


// =========================
// RENDER UI
// =========================

function parseCreditValue(value) {
  if (!value) return 0;

  const text = String(value).trim().toUpperCase();
  const number = parseFloat(text.replace(/[^\d.]/g, ""));

  if (isNaN(number)) return 0;

  if (text.includes("K")) return number * 1000;
  if (text.includes("M")) return number * 1000000;
  if (text.includes("B")) return number * 1000000000;

  return number;
}

function getSessionAgeText(dateString) {
  if (!dateString) return "Unknown";

  const now = new Date();
  const saved = new Date(dateString);

  const diffMs = now - saved;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 0) return "Today";
  if (days === 1) return "1 day";

  return `${days} days`;
}

function getRelativeTime(dateString) {
  if (!dateString) return "Unknown";

  const now = new Date();
  const date = new Date(dateString);

  const diffMs = now - date;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (seconds < 60) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (hours < 24) return `Updated ${hours} hr ago`;

  return `Updated ${days} day${days > 1 ? "s" : ""} ago`;
}

function renderAccounts(accounts) {

  accountsList.innerHTML = "";

  if (accounts.length === 0) {

    accountsList.innerHTML = `
      <div class="account-card">
        No accounts added yet.
      </div>
    `;

    return;
  }

  accounts.forEach((account, index) => {
  const accountNumber = index + 1;

    const div = document.createElement("div");
    

const spentValue = parseCreditValue(account.spent);
const availableValue = parseCreditValue(account.credits);
const totalValue = spentValue + availableValue;

const usedPercent = totalValue > 0
  ? Math.round((spentValue / totalValue) * 100)
  : 0;

const leftPercent = 100 - usedPercent;
const isLowCredit = availableValue < 2000;
   div.className = `
  account-card
  ${isLowCredit ? "low-credit" : ""}
`;
    div.innerHTML = `
  <div class="account-number">
    #${accountNumber}
  </div>
  <div class="account-email">
    ${account.email || "Unknown Account"}
  </div>

  <div class="credit-row">
    <span>Spent: ${account.spent || "Unknown"}</span>
    <span>Available: ${account.credits || "Unknown"}</span>
  </div>

  <div class="credit-bar">
    <div class="credit-used" style="width: ${usedPercent}%"></div>
    <div class="credit-left" style="width: ${leftPercent}%"></div>

    <div class="credit-bar-label">
    ${usedPercent}% used | ${leftPercent}% left
  </div>
  </div>

  <div class="credit-percent">
    Used ${usedPercent}% · Left ${leftPercent}%
  </div>

  <div class="visual-status ${account.refreshStatus || "unknown"}">
  <span class="status-dot"></span>
  <span>
    ${
      account.refreshStatus === "success"
        ? "Active"
        : account.refreshStatus === "refreshing"
        ? "Refreshing"
        : account.refreshStatus === "expired"
        ? "Expired"
        : account.refreshStatus === "failed"
        ? "Failed"
        : account.refreshStatus === "reconnecting"
        ? "Reconnecting"
        : account.refreshStatus || "Unknown"
    }
  </span>
</div>

<details class="account-details">
  <summary>Details</summary>

  <div class="account-status">
    Plan Status: ${account.status || "Unknown"}
  </div>

  <div class="account-updated">
    ${getRelativeTime(account.lastUpdated)}
  </div>

  <div class="account-updated-exact">
    ${account.lastUpdated || "Never"}
  </div>

  <div class="session-age">
    Session age:
    ${getSessionAgeText(account.sessionSavedAt)}
  </div>

  <button class="remove-btn" data-index="${index}">
    Remove
  </button>

</details>

  ${
    account.refreshError
      ? `
      <div class="account-error">
        ${account.refreshError}
      </div>
    `
      : ""
  }
  ${
  account.refreshStatus === "expired"
    ? `
      <button class="reconnect-btn" data-index="${index}">
        Reconnect Session
      </button>
    `
    : ""
}

`;

    accountsList.appendChild(div);

  });

}

accountsList.addEventListener("click", (event) => {
  if (!event.target.classList.contains("reconnect-btn")) return;

  const index = Number(event.target.dataset.index);

  chrome.runtime.sendMessage({
    action: "reconnectAccount",
    index
  });
});

accountsList.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-btn")) return;

  const index = Number(event.target.dataset.index);

  const confirmed = confirm("Remove this account?");

if (!confirmed) return;

chrome.runtime.sendMessage({
  action: "removeAccount",
  index
}, () => {
  loadAccounts();
});
});

// =========================
// ADD ACCOUNT
// =========================

addAccountBtn.addEventListener("click", async () => {

  statusText.innerText = "Opening login window...";

  chrome.runtime.sendMessage({
    action: "addAccount"
  });

});


// =========================
// REFRESH
// =========================

refreshBtn.addEventListener("click", async () => {

  statusText.innerText = "Refreshing accounts...";

  chrome.runtime.sendMessage({
    action: "refreshAccounts"
  }, (response) => {

    if (response && response.success) {

      statusText.innerText = "Refresh completed";

      loadAccounts();

    } else {

      statusText.innerText = "Refresh failed";

    }

  });

});


// =========================
// LISTEN FOR UPDATES
// =========================

chrome.storage.onChanged.addListener(() => {

  loadAccounts();

});