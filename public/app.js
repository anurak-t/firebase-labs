import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  getDatabase,
  child,
  connectDatabaseEmulator,
  off,
  onDisconnect,
  onValue,
  push,
  ref,
  serverTimestamp as rtdbServerTimestamp,
  set,
  update
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  app: null,
  auth: null,
  db: null,
  rtdb: null,
  user: null,
  users: new Map(),
  statuses: new Map(),
  postListeners: [],
  activeChat: null,
  chatMessagesRef: null,
  typingRef: null,
  typingTimer: null,
  unsubscribeUsers: null,
  unsubscribePosts: null,
  unsubscribeConnection: null,
  unsubscribeStatuses: null
};

const els = {
  configWarning: $("#config-warning"),
  loginView: $("#login-view"),
  appView: $("#app-view"),
  googleLogin: $("#google-login"),
  loginError: $("#login-error"),
  logoutButton: $("#logout-button"),
  topbarPhoto: $("#topbar-photo"),
  topbarName: $("#topbar-name"),
  profilePhoto: $("#profile-photo"),
  profileName: $("#profile-name"),
  profileEmail: $("#profile-email"),
  composerPhoto: $("#composer-photo"),
  presencePill: $("#presence-pill"),
  postForm: $("#post-form"),
  postText: $("#post-text"),
  postCount: $("#post-count"),
  feed: $("#feed"),
  refreshFeed: $("#refresh-feed"),
  peopleList: $("#people-list"),
  peopleSearch: $("#people-search"),
  chatTitle: $("#chat-title"),
  chatSubtitle: $("#chat-subtitle"),
  chatMessages: $("#chat-messages"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  chatSubmit: $("#chat-form button"),
  closeChat: $("#close-chat"),
  typingStatus: $("#typing-status"),
  postTemplate: $("#post-template")
};

bootstrap();

async function bootstrap() {
  let configModule;

  try {
    configModule = await import("./firebase-config.js");
  } catch (error) {
    showConfigWarning(error);
    return;
  }

  const { firebaseConfig, useEmulators = false } = configModule;
  if (!firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY") {
    showConfigWarning();
    return;
  }

  state.app = initializeApp(firebaseConfig);
  state.auth = getAuth(state.app);
  state.db = getFirestore(state.app);
  state.rtdb = getDatabase(state.app);

  if (useEmulators) {
    connectAuthEmulator(state.auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(state.db, "127.0.0.1", 8080);
    connectDatabaseEmulator(state.rtdb, "127.0.0.1", 9000);
  }

  bindStaticEvents();
  onAuthStateChanged(state.auth, handleAuthState);
}

function showConfigWarning(error) {
  els.configWarning.hidden = false;
  els.googleLogin.disabled = true;
  els.loginError.textContent = "ไม่พบไฟล์ firebase-config.js จึงยังเชื่อม Firebase ไม่ได้";
  if (error) {
    console.info("Firebase config is not ready yet:", error.message);
  }
}

function bindStaticEvents() {
  els.googleLogin.addEventListener("click", signInWithGoogle);
  els.logoutButton.addEventListener("click", () => signOut(state.auth));
  els.postForm.addEventListener("submit", createPost);
  els.postText.addEventListener("input", () => {
    els.postCount.textContent = `${els.postText.value.length}/1000`;
  });
  els.peopleSearch.addEventListener("input", renderPeople);
  els.chatForm.addEventListener("submit", sendChatMessage);
  els.chatInput.addEventListener("input", handleTyping);
  els.closeChat.addEventListener("click", closeChat);
  els.refreshFeed.addEventListener("click", subscribePosts);
}

async function signInWithGoogle() {
  els.loginError.textContent = "";
  els.googleLogin.disabled = true;

  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(state.auth, provider);
  } catch (error) {
    els.loginError.textContent = toFriendlyError(error);
  } finally {
    els.googleLogin.disabled = false;
  }
}

async function handleAuthState(user) {
  cleanupRealtime();
  state.user = user;

  if (!user) {
    els.loginView.hidden = false;
    els.appView.hidden = true;
    return;
  }

  els.loginView.hidden = true;
  els.appView.hidden = false;
  paintCurrentUser(user);

  await ensureUserProfile(user);
  setupPresence(user);
  subscribeUsers();
  subscribeStatuses();
  subscribePosts();
}

function paintCurrentUser(user) {
  const photo = user.photoURL || avatarFallback(user.displayName);
  const name = user.displayName || "Circle Member";

  els.topbarPhoto.src = photo;
  els.profilePhoto.src = photo;
  els.composerPhoto.src = photo;
  els.topbarName.textContent = name;
  els.profileName.textContent = name;
  els.profileEmail.textContent = user.email || "Google account";
}

async function ensureUserProfile(user) {
  const userRef = doc(state.db, "users", user.uid);
  const snapshot = await getDoc(userRef);
  const profile = {
    uid: user.uid,
    displayName: user.displayName || "Circle Member",
    email: user.email || "",
    photoURL: user.photoURL || avatarFallback(user.displayName),
    updatedAt: serverTimestamp()
  };

  if (snapshot.exists()) {
    await updateDoc(userRef, profile);
    return;
  }

  await setDoc(userRef, {
    ...profile,
    createdAt: serverTimestamp()
  });
}

function setupPresence(user) {
  const statusRef = ref(state.rtdb, `status/${user.uid}`);
  const connectedRef = ref(state.rtdb, ".info/connected");
  const online = {
    state: "online",
    lastChanged: rtdbServerTimestamp(),
    displayName: user.displayName || "Circle Member",
    photoURL: user.photoURL || avatarFallback(user.displayName)
  };
  const offline = {
    ...online,
    state: "offline",
    lastChanged: rtdbServerTimestamp()
  };

  state.unsubscribeConnection = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() === false) return;
    onDisconnect(statusRef).set(offline).then(() => set(statusRef, online));
  });
}

function subscribeUsers() {
  if (state.unsubscribeUsers) state.unsubscribeUsers();

  state.unsubscribeUsers = onSnapshot(collection(state.db, "users"), (snapshot) => {
    state.users.clear();
    snapshot.forEach((userDoc) => state.users.set(userDoc.id, userDoc.data()));
    renderPeople();
  });
}

function subscribeStatuses() {
  const statusesRef = ref(state.rtdb, "status");
  if (state.unsubscribeStatuses) state.unsubscribeStatuses();

  state.unsubscribeStatuses = onValue(statusesRef, (snapshot) => {
    state.statuses.clear();
    const statuses = snapshot.val() || {};
    Object.entries(statuses).forEach(([uid, value]) => state.statuses.set(uid, value));
    renderPeople();
  });
}

function subscribePosts() {
  if (state.unsubscribePosts) state.unsubscribePosts();
  clearPostListeners();

  const postsQuery = query(collection(state.db, "posts"), orderBy("createdAt", "desc"), limit(30));
  state.unsubscribePosts = onSnapshot(
    postsQuery,
    (snapshot) => {
      els.feed.innerHTML = "";
      if (snapshot.empty) {
        els.feed.innerHTML = `<article class="post empty-state">ยังไม่มีโพสต์ ลองแชร์เรื่องแรกใน Circle ของคุณ</article>`;
        return;
      }
      snapshot.forEach((postDoc) => renderPost(postDoc.id, postDoc.data()));
    },
    (error) => {
      els.feed.innerHTML = `<article class="post form-error">${toFriendlyError(error)}</article>`;
    }
  );
}

async function createPost(event) {
  event.preventDefault();
  const text = els.postText.value.trim();
  if (!text || !state.user) return;

  const button = els.postForm.querySelector("button");
  button.disabled = true;

  try {
    await addDoc(collection(state.db, "posts"), {
      authorId: state.user.uid,
      authorName: state.user.displayName || "Circle Member",
      authorPhotoURL: state.user.photoURL || avatarFallback(state.user.displayName),
      text,
      visibility: "public",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    els.postText.value = "";
    els.postCount.textContent = "0/1000";
  } catch (error) {
    alert(toFriendlyError(error));
  } finally {
    button.disabled = false;
  }
}

function renderPost(postId, post) {
  const node = els.postTemplate.content.firstElementChild.cloneNode(true);
  const commentsEl = node.querySelector(".comments");
  const likeButton = node.querySelector(".like-button");
  const likeCount = node.querySelector(".like-count");
  const deleteButton = node.querySelector(".delete-post");
  const commentForm = node.querySelector(".comment-form");

  node.dataset.postId = postId;
  node.querySelector(".post-author-photo").src = post.authorPhotoURL || avatarFallback(post.authorName);
  node.querySelector(".post-author").textContent = post.authorName || "Circle Member";
  node.querySelector(".post-time").textContent = formatDate(post.createdAt?.toDate?.());
  node.querySelector(".post-text").textContent = post.text || "";

  if (post.authorId === state.user.uid) {
    deleteButton.hidden = false;
    deleteButton.addEventListener("click", () => deleteDoc(doc(state.db, "posts", postId)));
  }

  likeButton.addEventListener("click", () => toggleLike(postId));
  commentForm.addEventListener("submit", (event) => addComment(event, postId));

  const likesRef = collection(state.db, "posts", postId, "likes");
  const unsubscribeLikes = onSnapshot(likesRef, (snapshot) => {
    const liked = snapshot.docs.some((likeDoc) => likeDoc.id === state.user.uid);
    likeButton.classList.toggle("active", liked);
    likeButton.textContent = liked ? "เลิกถูกใจ" : "ถูกใจ";
    likeCount.textContent = `${snapshot.size} likes`;
  });

  const commentsQuery = query(collection(state.db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
  const unsubscribeComments = onSnapshot(commentsQuery, (snapshot) => {
    commentsEl.innerHTML = "";
    snapshot.forEach((commentDoc) => {
      commentsEl.appendChild(renderComment(postId, commentDoc.id, commentDoc.data()));
    });
  });

  state.postListeners.push(unsubscribeLikes, unsubscribeComments);
  els.feed.appendChild(node);
}

async function toggleLike(postId) {
  const likeRef = doc(state.db, "posts", postId, "likes", state.user.uid);
  const snapshot = await getDoc(likeRef);

  if (snapshot.exists()) {
    await deleteDoc(likeRef);
    return;
  }

  await setDoc(likeRef, {
    uid: state.user.uid,
    createdAt: serverTimestamp()
  });
}

async function addComment(event, postId) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  const text = input.value.trim();
  if (!text) return;

  await addDoc(collection(state.db, "posts", postId, "comments"), {
    authorId: state.user.uid,
    authorName: state.user.displayName || "Circle Member",
    authorPhotoURL: state.user.photoURL || avatarFallback(state.user.displayName),
    text,
    createdAt: serverTimestamp()
  });
  input.value = "";
}

function renderComment(postId, commentId, comment) {
  const row = document.createElement("div");
  row.className = "comment";
  row.innerHTML = `
    <img class="avatar" alt="" src="${escapeAttr(comment.authorPhotoURL || avatarFallback(comment.authorName))}" />
    <div class="comment-bubble">
      <strong></strong>
      <p></p>
    </div>
  `;
  row.querySelector("strong").textContent = comment.authorName || "Circle Member";
  row.querySelector("p").textContent = comment.text || "";

  if (comment.authorId === state.user.uid) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.textContent = "×";
    button.setAttribute("aria-label", "ลบความคิดเห็น");
    button.addEventListener("click", () => deleteDoc(doc(state.db, "posts", postId, "comments", commentId)));
    row.appendChild(button);
  }

  return row;
}

function renderPeople() {
  if (!state.user) return;

  const term = els.peopleSearch.value.trim().toLowerCase();
  const users = [...state.users.entries()]
    .filter(([uid]) => uid !== state.user.uid)
    .filter(([, user]) => !term || (user.displayName || "").toLowerCase().includes(term))
    .sort(([uidA], [uidB]) => {
      const aOnline = state.statuses.get(uidA)?.state === "online";
      const bOnline = state.statuses.get(uidB)?.state === "online";
      return Number(bOnline) - Number(aOnline);
    });

  els.peopleList.innerHTML = "";
  if (users.length === 0) {
    els.peopleList.innerHTML = `<p class="empty-state">ยังไม่มีคนอื่นใน Circle นี้</p>`;
    return;
  }

  users.forEach(([uid, user]) => {
    const status = state.statuses.get(uid);
    const isOnline = status?.state === "online";
    const button = document.createElement("button");
    button.className = `person-button ${state.activeChat?.peerUid === uid ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <img class="avatar" alt="" src="${escapeAttr(user.photoURL || avatarFallback(user.displayName))}" />
      <span><strong></strong><span>${isOnline ? "online" : "offline"}</span></span>
      <i class="status-dot ${isOnline ? "online" : ""}"></i>
    `;
    button.querySelector("strong").textContent = user.displayName || "Circle Member";
    button.addEventListener("click", () => openChat(uid, user));
    els.peopleList.appendChild(button);
  });
}

async function openChat(peerUid, peer) {
  if (!state.user || peerUid === state.user.uid) return;
  closeChatListeners();

  const chatId = buildChatId(state.user.uid, peerUid);
  const now = Date.now();
  const currentInfo = {
    displayName: state.user.displayName || "Circle Member",
    photoURL: state.user.photoURL || avatarFallback(state.user.displayName)
  };
  const peerInfo = {
    displayName: peer.displayName || "Circle Member",
    photoURL: peer.photoURL || avatarFallback(peer.displayName)
  };

  await update(ref(state.rtdb, `chats/${chatId}`), {
    [`members/${state.user.uid}`]: true,
    [`members/${peerUid}`]: true,
    [`memberInfo/${state.user.uid}`]: currentInfo,
    [`memberInfo/${peerUid}`]: peerInfo,
    createdAt: now,
    updatedAt: now,
    lastMessage: "",
    lastSenderId: ""
  });

  state.activeChat = { chatId, peerUid, peer };
  els.chatTitle.textContent = peerInfo.displayName;
  els.chatSubtitle.textContent = "Direct message";
  els.chatInput.disabled = false;
  els.chatSubmit.disabled = false;
  els.chatInput.focus();
  renderPeople();

  state.chatMessagesRef = ref(state.rtdb, `chatMessages/${chatId}`);
  onValue(state.chatMessagesRef, (snapshot) => {
    renderMessages(snapshot.val() || {});
  });

  state.typingRef = ref(state.rtdb, `typing/${chatId}`);
  onValue(state.typingRef, (snapshot) => {
    const typing = snapshot.val() || {};
    els.typingStatus.textContent = typing[peerUid] ? `${peerInfo.displayName} กำลังพิมพ์...` : "";
  });
}

function renderMessages(messages) {
  const entries = Object.entries(messages).sort(([, a], [, b]) => (a.createdAt || 0) - (b.createdAt || 0));
  els.chatMessages.innerHTML = "";

  if (entries.length === 0) {
    els.chatMessages.innerHTML = `<p class="empty-state">ยังไม่มีข้อความ ส่งข้อความแรกได้เลย</p>`;
    return;
  }

  entries.forEach(([, message]) => {
    const mine = message.senderId === state.user.uid;
    const row = document.createElement("div");
    row.className = `message ${mine ? "mine" : ""}`;
    row.innerHTML = `
      <div class="message-bubble"></div>
      <small></small>
    `;
    row.querySelector(".message-bubble").textContent = message.text || "";
    row.querySelector("small").textContent = mine ? "คุณ" : message.senderName || "เพื่อน";
    els.chatMessages.appendChild(row);
  });

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!state.activeChat) return;

  const text = els.chatInput.value.trim();
  if (!text) return;

  const now = Date.now();
  const message = {
    senderId: state.user.uid,
    senderName: state.user.displayName || "Circle Member",
    senderPhotoURL: state.user.photoURL || avatarFallback(state.user.displayName),
    text,
    createdAt: now
  };

  els.chatInput.value = "";
  await set(ref(state.rtdb, `typing/${state.activeChat.chatId}/${state.user.uid}`), false);
  await push(ref(state.rtdb, `chatMessages/${state.activeChat.chatId}`), message);
  await update(ref(state.rtdb, `chats/${state.activeChat.chatId}`), {
    lastMessage: text.slice(0, 160),
    lastSenderId: state.user.uid,
    updatedAt: now
  });
}

function handleTyping() {
  if (!state.activeChat) return;

  const typingUserRef = ref(state.rtdb, `typing/${state.activeChat.chatId}/${state.user.uid}`);
  set(typingUserRef, els.chatInput.value.length > 0);
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => set(typingUserRef, false), 1200);
}

function closeChat() {
  closeChatListeners();
  state.activeChat = null;
  els.chatTitle.textContent = "Messages";
  els.chatSubtitle.textContent = "เลือกคนเพื่อเริ่มคุย";
  els.chatMessages.innerHTML = `<p class="empty-state">เลือกคนจากรายชื่อเพื่อเริ่มคุย</p>`;
  els.typingStatus.textContent = "";
  els.chatInput.value = "";
  els.chatInput.disabled = true;
  els.chatSubmit.disabled = true;
  renderPeople();
}

function closeChatListeners() {
  if (state.chatMessagesRef) off(state.chatMessagesRef);
  if (state.typingRef) off(state.typingRef);
  if (state.activeChat && state.user) {
    set(ref(state.rtdb, `typing/${state.activeChat.chatId}/${state.user.uid}`), false);
  }
  state.chatMessagesRef = null;
  state.typingRef = null;
}

function cleanupRealtime() {
  if (state.unsubscribeUsers) state.unsubscribeUsers();
  if (state.unsubscribePosts) state.unsubscribePosts();
  if (state.unsubscribeConnection) state.unsubscribeConnection();
  if (state.unsubscribeStatuses) state.unsubscribeStatuses();
  clearPostListeners();
  closeChatListeners();
  state.users.clear();
  state.statuses.clear();
}

function clearPostListeners() {
  state.postListeners.forEach((unsubscribe) => unsubscribe());
  state.postListeners = [];
}

function buildChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

function formatDate(date) {
  if (!date) return "กำลังบันทึก...";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function avatarFallback(name = "Circle Member") {
  const label = encodeURIComponent(name.trim().slice(0, 2) || "FS");
  return `https://ui-avatars.com/api/?name=${label}&background=1877f2&color=ffffff&bold=true`;
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function toFriendlyError(error) {
  if (!error) return "เกิดข้อผิดพลาด";
  if (error.code === "permission-denied" || error.code === "PERMISSION_DENIED") {
    return "permission-denied: Security Rules ปฏิเสธการเขียน/อ่านนี้";
  }
  if (error.code === "auth/popup-closed-by-user") {
    return "ปิดหน้าต่าง Google Sign-In ก่อนเข้าสู่ระบบ";
  }
  return error.message || String(error);
}
