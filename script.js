document.documentElement.classList.add("js");

const yearNode = document.getElementById("year");
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

const revealNodes = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.18,
    }
  );

  revealNodes.forEach((node) => observer.observe(node));
} else {
  revealNodes.forEach((node) => node.classList.add("is-visible"));
}

const ownerMeta = document.querySelector('meta[name="site-owner"]');
const repoMeta = document.querySelector('meta[name="site-repo"]');
const branchMeta = document.querySelector('meta[name="site-branch"]');
const fileMeta = document.querySelector('meta[name="site-file"]');

const ownerEditor = {
  owner: ownerMeta?.content ?? "",
  repo: repoMeta?.content ?? "",
  branch: branchMeta?.content ?? "main",
  filePath: fileMeta?.content ?? "index.html",
  sessionKey: "lbg-owner-editor-token",
  enabled: new URLSearchParams(window.location.search).get("edit") === "1",
  token: "",
  verifiedLogin: "",
  editing: false,
  savedDraft: {},
};

const adminTrigger = document.getElementById("adminTrigger");
const editorDrawer = document.getElementById("editorDrawer");
const editorClose = document.getElementById("editorClose");
const editorAuthForm = document.getElementById("editorAuthForm");
const editorTokenInput = document.getElementById("editorToken");
const editorActions = document.getElementById("editorActions");
const editorStatus = document.getElementById("editorStatus");
const editorAccount = document.getElementById("editorAccount");
const startEditButton = document.getElementById("startEdit");
const saveEditButton = document.getElementById("saveEdit");
const cancelEditButton = document.getElementById("cancelEdit");
const logoutEditButton = document.getElementById("logoutEdit");
const editableNodes = Array.from(document.querySelectorAll("[data-edit-id]"));

function setStatus(message, kind = "info") {
  if (!editorStatus) {
    return;
  }

  editorStatus.textContent = message;
  editorStatus.dataset.kind = kind;
}

function setAccountLabel(message) {
  if (editorAccount) {
    editorAccount.textContent = message;
  }
}

function captureDraft(root = document) {
  const draft = {};

  root.querySelectorAll("[data-edit-id]").forEach((node) => {
    draft[node.dataset.editId] = node.textContent ?? "";
  });

  return draft;
}

function applyDraft(draft, root = document) {
  root.querySelectorAll("[data-edit-id]").forEach((node) => {
    const value = draft[node.dataset.editId];
    if (typeof value === "string") {
      node.textContent = value;
    }
  });
}

function draftsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setEditingState(enabled) {
  ownerEditor.editing = enabled;
  document.body.classList.toggle("is-editing", enabled);

  editableNodes.forEach((node) => {
    node.contentEditable = enabled ? "true" : "false";
    node.spellcheck = enabled;
  });

  if (startEditButton) {
    startEditButton.disabled = enabled;
  }

  if (saveEditButton) {
    saveEditButton.disabled = !enabled;
  }

  if (cancelEditButton) {
    cancelEditButton.disabled = !enabled;
  }
}

function toggleEditor(open) {
  if (!editorDrawer) {
    return;
  }

  editorDrawer.hidden = !open;
}

function clearSessionToken() {
  sessionStorage.removeItem(ownerEditor.sessionKey);
  ownerEditor.token = "";
  ownerEditor.verifiedLogin = "";
}

async function githubRequest(path, token, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;

    try {
      const payload = await response.json();
      detail = payload.message || detail;
    } catch (error) {
      // Ignore JSON parse failures for plain-text error bodies.
    }

    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function verifyOwnerToken(token) {
  const user = await githubRequest("/user", token);

  if (!user?.login || user.login.toLowerCase() !== ownerEditor.owner.toLowerCase()) {
    throw new Error(`허용된 계정은 ${ownerEditor.owner}만 가능하다.`);
  }

  ownerEditor.token = token;
  ownerEditor.verifiedLogin = user.login;
  sessionStorage.setItem(ownerEditor.sessionKey, token);
  ownerEditor.savedDraft = captureDraft();
  setAccountLabel(`${user.login} 확인됨`);
  setStatus("소유자 인증이 끝났다. 이제 편집 모드를 시작할 수 있다.", "success");

  if (editorActions) {
    editorActions.hidden = false;
  }

  if (editorTokenInput) {
    editorTokenInput.value = "";
  }
}

function decodeBase64Utf8(value) {
  const binary = window.atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return window.btoa(binary);
}

async function saveIndexHtml() {
  const draft = captureDraft();
  const file = await githubRequest(
    `/repos/${ownerEditor.owner}/${ownerEditor.repo}/contents/${ownerEditor.filePath}?ref=${ownerEditor.branch}`,
    ownerEditor.token
  );

  const parser = new DOMParser();
  const sourceHtml = decodeBase64Utf8(file.content);
  const parsed = parser.parseFromString(sourceHtml, "text/html");

  applyDraft(draft, parsed);

  const nextHtml = `<!doctype html>\n${parsed.documentElement.outerHTML}\n`;
  const payload = {
    message: "Update site copy from inline editor",
    content: encodeBase64Utf8(nextHtml),
    sha: file.sha,
    branch: ownerEditor.branch,
  };

  await githubRequest(
    `/repos/${ownerEditor.owner}/${ownerEditor.repo}/contents/${ownerEditor.filePath}`,
    ownerEditor.token,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );

  ownerEditor.savedDraft = draft;
  setEditingState(false);
  setStatus("저장이 끝났다. GitHub Pages 반영에는 잠깐 시간이 걸릴 수 있다.", "success");
}

function resetEditorUi() {
  setEditingState(false);
  applyDraft(ownerEditor.savedDraft);

  if (editorActions) {
    editorActions.hidden = true;
  }

  setAccountLabel("인증 대기");
  setStatus("소유자 인증 뒤에만 편집할 수 있다.", "info");
}

async function restoreSession() {
  const storedToken = sessionStorage.getItem(ownerEditor.sessionKey);

  if (!storedToken) {
    resetEditorUi();
    return;
  }

  try {
    await verifyOwnerToken(storedToken);
  } catch (error) {
    clearSessionToken();
    resetEditorUi();
    setStatus("세션 복원에 실패했다. 토큰을 다시 확인해 달라.", "error");
  }
}

function initializeOwnerEditor() {
  if (!ownerEditor.enabled || !adminTrigger || !editorDrawer) {
    return;
  }

  adminTrigger.hidden = false;
  toggleEditor(true);
  setEditingState(false);
  restoreSession();

  adminTrigger.addEventListener("click", () => {
    toggleEditor(editorDrawer.hidden);
  });

  editorClose?.addEventListener("click", () => {
    toggleEditor(false);
  });

  editorAuthForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const token = editorTokenInput?.value.trim();
    if (!token) {
      setStatus("GitHub 토큰을 입력해 달라.", "error");
      return;
    }

    setStatus("GitHub 계정을 확인하는 중이다.", "info");

    try {
      await verifyOwnerToken(token);
    } catch (error) {
      clearSessionToken();
      resetEditorUi();
      setStatus(error.message || "인증에 실패했다.", "error");
    }
  });

  startEditButton?.addEventListener("click", () => {
    if (!ownerEditor.token) {
      setStatus("먼저 소유자 인증이 필요하다.", "error");
      return;
    }

    ownerEditor.savedDraft = captureDraft();
    setEditingState(true);
    setStatus("편집 모드가 열렸다. 페이지 글씨를 직접 수정한 뒤 저장하면 된다.", "info");
  });

  cancelEditButton?.addEventListener("click", () => {
    applyDraft(ownerEditor.savedDraft);
    setEditingState(false);
    setStatus("이번 편집은 취소했다.", "info");
  });

  saveEditButton?.addEventListener("click", async () => {
    if (!ownerEditor.token) {
      setStatus("먼저 소유자 인증이 필요하다.", "error");
      return;
    }

    if (!draftsMatch(captureDraft(), ownerEditor.savedDraft)) {
      setStatus("GitHub 저장소에 저장하는 중이다.", "info");
    } else {
      setStatus("바뀐 내용이 없다.", "info");
      return;
    }

    saveEditButton.disabled = true;
    cancelEditButton.disabled = true;

    try {
      await saveIndexHtml();
    } catch (error) {
      setStatus(error.message || "저장에 실패했다.", "error");
      setEditingState(true);
    } finally {
      if (saveEditButton) {
        saveEditButton.disabled = !ownerEditor.editing;
      }

      if (cancelEditButton) {
        cancelEditButton.disabled = !ownerEditor.editing;
      }
    }
  });

  logoutEditButton?.addEventListener("click", () => {
    clearSessionToken();
    resetEditorUi();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!ownerEditor.editing) {
      return;
    }

    if (draftsMatch(captureDraft(), ownerEditor.savedDraft)) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  });
}

initializeOwnerEditor();
