(function () {
  const state = () => window.aetherisState;
  const api = () => window.aetherisApi;
  const ui = () => window.appUi;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const listFrom = (result, key) => Array.isArray(result) ? result : (result && Array.isArray(result[key]) ? result[key] : []);
  const safeUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');
  const PAGE_SIZE = 50;
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  const mediaObjectUrls = new Map();

  let typingTimer = null;
  let typingConversationId = null;
  let remoteTypingTimer = null;
  let readTimer = null;
  let sending = false;
  let uploading = false;
  let pendingCreate = false;
  let hadSocketBefore = false;
  let previewUrl = null;
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceStartedAt = 0;
  let voiceTimer = null;
  let voiceCancelled = false;

  function socket() { return window.aetherisSocket?.connection; }
  function me() { return Number(state().currentUser?.id); }
  function findConversation(id) { return state().conversations.find((item) => Number(item.id) === Number(id)) || null; }
  function chatTabVisible() { return window.appNav?.activeTab === 'chat' && !document.hidden; }

  function starredKey() { return `aetheris_starred_${me()}`; }
  function starredSet() { try { return new Set(JSON.parse(localStorage.getItem(starredKey()) || '[]')); } catch (e) { return new Set(); } }
  function isStarred(conversation) { return starredSet().has(Number(conversation.id)); }

  function formatTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function snippetFor(message) {
    if (!message) return '';
    const text = message.text || message.caption || '';
    switch (message.type) {
      case 'image': return `📷 ${text || 'Photo'}`;
      case 'video': return `🎬 ${text || 'Video'}`;
      case 'audio': return '🎤 Voice message';
      case 'file': return `📎 ${text || 'File'}`;
      case 'reel': return '🎞 Reel';
      default: return text;
    }
  }

  function lastOf(conversation) {
    const messages = conversation.messages;
    if (Array.isArray(messages) && messages.length) {
      const m = messages[messages.length - 1];
      return { type: m.type, text: m.text, time: m.time, at: m.created_at };
    }
    const last = conversation.lastMessage;
    return last ? { type: last.type, text: last.text, time: formatTime(last.createdAt), at: last.createdAt } : null;
  }

  function activityOf(conversation) {
    const last = lastOf(conversation);
    const value = Date.parse(last?.at || conversation.updated_at || conversation.created_at || '');
    return Number.isNaN(value) ? 0 : value;
  }

  function nearBottom(stream) { return !stream || stream.scrollHeight - stream.scrollTop - stream.clientHeight < 140; }

  window.appChat = {
    init() {
      const stream = document.getElementById('messageStream');
      stream?.addEventListener('scroll', () => {
        document.getElementById('scrollToBottomBtn')?.classList.toggle('hidden', nearBottom(stream));
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.markConversationRead(); });
      window.addEventListener('aetheris:socket-connected', () => {
        if (hadSocketBefore) { ui().toast('Back online', 'success'); this.resync(); }
        hadSocketBefore = true;
      });
      window.addEventListener('aetheris:socket-disconnected', (event) => {
        if (event.detail?.reason !== 'io client disconnect') ui().toast('Connection lost. Reconnecting…', 'error');
      });
    },

    reset() {
      clearTimeout(typingTimer); clearTimeout(remoteTypingTimer); clearTimeout(readTimer);
      typingConversationId = null; sending = false; hadSocketBefore = false;
      mediaObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      mediaObjectUrls.clear();
      state().conversations = [];
      state().activeConversationId = null;
      this.searchQuery = '';
      this.renderConversations();
      this.renderActiveChat();
      this.updateTitleBadge();
      ['conversationSearchInput', 'globalSearchInput', 'messageTextInput'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    },

    activeContact() { return findConversation(state().activeConversationId); },

    mergeConversations(fresh) {
      const previous = new Map(state().conversations.map((item) => [Number(item.id), item]));
      state().conversations = fresh.map((item) => {
        const old = previous.get(Number(item.id));
        if (old) { item.messages = old.messages; item.hasMore = old.hasMore; item.blocked = old.blocked; }
        return item;
      });
    },

    async loadConversations(options = {}) {
      try {
        const response = await api().fetchConversations();
        this.mergeConversations(listFrom(response, 'conversations'));
        if (!findConversation(state().activeConversationId)) state().activeConversationId = this.sortedConversations()[0]?.id || null;
        this.renderConversations();
        this.updateTitleBadge();
        const active = this.activeContact();
        if (active && (!active.messages || options.reloadActive)) await this.loadMessages(active.id);
        else this.renderActiveChat();
      } catch (error) {
        if (!options.quiet) {
          const list = document.getElementById('conversationList');
          if (list) list.innerHTML = `<div class="p-5 text-center text-xs text-rose-400">${escapeHtml(error.message || 'Unable to load chats.')}</div>`;
          this.renderActiveChat(error);
        }
      }
    },

    async resync() {
      await this.loadConversations({ quiet: true, reloadActive: true });
      window.appNotifs?.refreshBadge?.();
    },

    async loadMessages(conversationId) {
      try {
        const response = await api().fetchMessages(conversationId);
        const conversation = findConversation(conversationId);
        if (!conversation) return;
        conversation.messages = listFrom(response, 'messages');
        conversation.hasMore = conversation.messages.length >= PAGE_SIZE;
        if (Number(conversationId) === Number(state().activeConversationId)) {
          this.renderActiveChat(null, { forceBottom: true });
          this.markConversationRead();
        }
        this.renderConversations();
      } catch (error) { this.renderActiveChat(error); }
    },

    async loadOlderMessages() {
      const conversation = this.activeContact();
      const first = conversation?.messages?.[0];
      if (!conversation || !first) return;
      const stream = document.getElementById('messageStream');
      const previousHeight = stream.scrollHeight;
      try {
        const response = await api().fetchMessages(conversation.id, { beforeId: first.id });
        const older = listFrom(response, 'messages');
        const known = new Set(conversation.messages.map((item) => Number(item.id)));
        conversation.messages = older.filter((item) => !known.has(Number(item.id))).concat(conversation.messages);
        conversation.hasMore = older.length >= PAGE_SIZE;
        this.renderActiveChat(null, { keepPosition: true });
        stream.scrollTop = stream.scrollHeight - previousHeight;
      } catch (error) { ui().toast(error.message, 'error'); }
    },

    sortedConversations() {
      return [...state().conversations].sort((a, b) => activityOf(b) - activityOf(a));
    },

    setFolderFilter(filter) {
      state().currentFilter = filter;
      ['all', 'unread', 'starred', 'reels'].forEach((name) => {
        const button = document.getElementById(`filter-${name}`);
        if (!button) return;
        button.className = name === filter ? 'px-2.5 py-1 rounded-lg text-xs font-medium bg-cyan-500 text-slate-950' : 'px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 light:bg-slate-200 text-slate-400 hover:text-slate-200';
      });
      this.renderConversations();
    },

    filterConversations(query) {
      this.searchQuery = query || '';
      this.renderConversations();
    },

    toggleStar(conversationId) {
      const set = starredSet();
      const id = Number(conversationId);
      if (set.has(id)) set.delete(id); else set.add(id);
      localStorage.setItem(starredKey(), JSON.stringify([...set]));
      this.renderConversations();
    },

    updateTitleBadge() {
      const total = state().conversations.reduce((sum, item) => sum + (Number(item.unread) || 0), 0);
      document.title = `${total > 0 ? `(${total > 99 ? '99+' : total}) ` : ''}Aetheris — Private Messenger & Reels`;
    },

    renderConversations() {
      const list = document.getElementById('conversationList');
      if (!list) return;
      const query = (this.searchQuery || '').trim().toLowerCase();
      let conversations = this.sortedConversations();
      if (state().currentFilter === 'unread') conversations = conversations.filter((item) => item.unread > 0);
      if (state().currentFilter === 'starred') conversations = conversations.filter(isStarred);
      if (state().currentFilter === 'reels') conversations = conversations.filter((item) => item.hasReels);
      if (query) conversations = conversations.filter((item) => `${item.name || ''} ${item.handle || ''}`.toLowerCase().includes(query));
      if (!conversations.length) {
        list.innerHTML = '<div class="p-8 text-center text-slate-500"><i data-lucide="messages-square" class="w-8 h-8 mx-auto mb-2 opacity-40"></i><p class="text-xs font-medium">No conversations available.</p></div>';
        if (window.lucide) window.lucide.createIcons();
        return;
      }
      list.innerHTML = '';
      conversations.forEach((conversation) => {
        const active = Number(conversation.id) === Number(state().activeConversationId);
        const last = lastOf(conversation);
        const item = document.createElement('div');
        item.className = `p-3.5 flex items-center gap-3 cursor-pointer transition-colors relative ${active ? 'bg-cyan-500/10 border-l-2 border-cyan-400' : 'hover:bg-slate-800/40'}`;
        item.onclick = () => this.openConversation(conversation.id);
        const unread = conversation.unread > 0 ? `<span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-400 text-slate-950 font-mono">${conversation.unread > 99 ? '99+' : escapeHtml(conversation.unread)}</span>` : '';
        item.innerHTML = `<div class="relative shrink-0"><img alt="" class="w-11 h-11 rounded-full object-cover ring-2 ${active ? 'ring-cyan-400' : 'ring-slate-700'}">${conversation.online ? '<span class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-[#090e1c]"></span>' : ''}</div><div class="flex-1 min-w-0"><div class="flex items-center justify-between mb-0.5"><span class="text-xs font-bold text-slate-200 light:text-slate-900 truncate">${escapeHtml(conversation.name || conversation.handle || 'Conversation')}</span><span class="text-[10px] text-slate-500 font-mono">${escapeHtml(last?.time || '')}</span></div><p class="text-xs ${conversation.unread > 0 ? 'text-slate-200 font-semibold' : 'text-slate-400'} light:text-slate-600 truncate">${escapeHtml(snippetFor(last))}</p></div><div class="flex flex-col items-end gap-1 shrink-0">${unread}<button type="button" class="star-toggle text-sm leading-none ${isStarred(conversation) ? 'text-amber-400' : 'text-slate-600 hover:text-amber-300'}" title="Favorite">${isStarred(conversation) ? '★' : '☆'}</button></div>`;
        item.querySelector('.star-toggle').onclick = (event) => { event.stopPropagation(); this.toggleStar(conversation.id); };
        list.appendChild(item);
        ui().setAvatar(item.querySelector('img'), conversation.other_user_id, conversation.avatar, conversation.name);
      });
      if (window.lucide) window.lucide.createIcons();
    },

    openConversation(conversationId) {
      if (Number(conversationId) !== Number(state().activeConversationId)) this.stopTyping();
      state().activeConversationId = Number(conversationId);
      this.hideTyping();
      document.getElementById('chatSearchDrawer')?.classList.add('hidden');
      const conversation = this.activeContact();
      this.renderConversations();
      this.toggleMobileSidebar(false);
      if (conversation?.messages) { this.renderActiveChat(null, { forceBottom: true }); this.markConversationRead(); }
      else this.loadMessages(conversationId);
    },

    renderHeader(conversation) {
      document.getElementById('activeChatName').innerText = conversation.name || conversation.handle || 'Conversation';
      ui().setAvatar(document.getElementById('activeChatAvatar'), conversation.other_user_id, conversation.avatar, conversation.name);
      const status = document.getElementById('activeChatStatus');
      status.textContent = conversation.online ? 'Online' : (conversation.lastSeen ? `Last seen ${ui().formatLastSeen(conversation.lastSeen)}` : 'Offline');
      status.classList.toggle('text-emerald-400', Boolean(conversation.online));
      status.classList.toggle('text-slate-400', !conversation.online);
      document.getElementById('activeChatOnlineBadge')?.classList.toggle('hidden', !conversation.online);
      document.getElementById('infoPanelOnlineBadge')?.classList.toggle('hidden', !conversation.online);
      document.getElementById('infoPanelName').innerText = conversation.name || '';
      document.getElementById('infoPanelHandle').innerText = conversation.handle || '';
      document.getElementById('infoPanelBio').innerText = conversation.bio || '';
      ui().setAvatar(document.getElementById('infoPanelAvatar'), conversation.other_user_id, conversation.avatar, conversation.name);
      this.renderBlockButton(conversation);
    },

    renderActiveChat(error, options = {}) {
      const conversation = this.activeContact();
      const stream = document.getElementById('messageStream');
      if (!stream) return;
      if (!conversation) {
        ['activeChatName', 'infoPanelName'].forEach((id) => { const el = document.getElementById(id); if (el) el.innerText = 'No conversation selected'; });
        document.getElementById('activeChatStatus').innerText = '';
        document.getElementById('activeChatOnlineBadge')?.classList.add('hidden');
        document.getElementById('infoPanelOnlineBadge')?.classList.add('hidden');
        stream.innerHTML = `<div class="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">${escapeHtml(error?.message || 'Select a conversation to view messages.')}</div>`;
        this.renderSharedPanel(null);
        return;
      }
      this.renderHeader(conversation);
      if (error) { stream.innerHTML = `<div class="p-5 text-center text-xs text-rose-400">${escapeHtml(error.message || 'Unable to load data.')}</div>`; return; }
      const wasNearBottom = nearBottom(stream);
      const previousTop = stream.scrollTop;
      stream.innerHTML = '';
      if (conversation.hasMore) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'mx-auto block px-3 py-1.5 rounded-full bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700';
        more.textContent = 'Load earlier messages';
        more.onclick = () => this.loadOlderMessages();
        stream.appendChild(more);
      }
      const messages = conversation.messages || [];
      if (!messages.length) stream.insertAdjacentHTML('beforeend', '<div class="empty-chat flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">No messages yet. Say hello!</div>');
      messages.forEach((message) => this.appendMessageElement(stream, message));
      if (options.forceBottom || (wasNearBottom && !options.keepPosition)) this.scrollToBottom();
      else stream.scrollTop = previousTop;
      this.renderSharedPanel(conversation);
      if (window.lucide) window.lucide.createIcons();
    },

    appendMessageElement(stream, message) {
      const element = this.buildMessageElement(message);
      stream.appendChild(element);
      this.hydrateMedia(element, message);
      return element;
    },

    renderSharedPanel(conversation) {
      const visuals = document.getElementById('sharedVisualsList');
      const reels = document.getElementById('sharedReelsList');
      const files = document.getElementById('sharedFilesList');
      if (!visuals || !reels || !files) return;
      const messages = conversation?.messages || [];
      const photos = messages.filter((m) => m.type === 'image').length;
      const videos = messages.filter((m) => m.type === 'video').length;
      visuals.textContent = photos || videos ? `${photos} photo(s), ${videos} video(s) in recent messages` : 'Shared media will appear here.';
      const reelMessages = messages.filter((m) => m.type === 'reel' && m.reel);
      reels.replaceChildren();
      if (!reelMessages.length) reels.textContent = 'No reels shared here yet.';
      reelMessages.slice(-5).forEach((m) => { const row = document.createElement('div'); row.className = 'truncate text-slate-300 py-0.5'; row.textContent = `🎞 ${m.reel.title || 'Reel'}`; reels.appendChild(row); });
      const fileMessages = messages.filter((m) => m.type === 'file');
      files.replaceChildren();
      if (!fileMessages.length) files.textContent = 'No files shared here yet.';
      fileMessages.slice(-5).forEach((m) => { const row = document.createElement('div'); row.className = 'truncate text-slate-300 py-0.5'; row.textContent = `📎 ${m.fileName || 'File'}`; files.appendChild(row); });
    },

    buildMessageElement(message) {
      const isMine = message.isMine === true || (message.sender_id != null && Number(message.sender_id) === me());
      const wrapper = document.createElement('div');
      wrapper.dataset.messageId = message.id;
      wrapper.className = `flex flex-col ${isMine ? 'items-end' : 'items-start'} group transition-all select-text`;
      const bubbleClass = isMine
        ? 'bg-gradient-to-r from-cyan-500 to-sky-500 text-slate-950 font-medium rounded-tr-none'
        : 'bg-slate-800/90 light:bg-slate-200 text-slate-100 light:text-slate-900 rounded-tl-none border border-slate-700/60 light:border-slate-300';
      const caption = message.caption || '';
      const captionHtml = caption ? `<p class="mt-1 text-xs text-slate-300 light:text-slate-600 break-words max-w-xs sm:max-w-sm whitespace-pre-wrap">${escapeHtml(caption)}</p>` : '';
      let content;
      switch (message.type) {
        case 'image':
          if (message.viewOnce && !isMine && !message.viewedAt) {
            content = '<button type="button" class="view-once-open max-w-xs sm:max-w-sm rounded-2xl border border-cyan-500/30 bg-slate-900/90 light:bg-slate-100 p-5 shadow-md text-left"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-cyan-500/15 flex items-center justify-center"><span class="text-cyan-400 text-lg">◉</span></div><div><div class="font-semibold text-slate-100 light:text-slate-900 text-sm">View photo once</div><div class="text-[11px] text-slate-400">Open once. It won\'t be available again.</div></div></div></button>';
          } else if (message.viewOnce && !isMine) {
            content = '<div class="max-w-xs sm:max-w-sm rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4 text-xs text-slate-400">✓ Photo viewed</div>';
          } else {
            content = `<div class="media-shell relative max-w-xs sm:max-w-sm rounded-2xl overflow-hidden border border-slate-700 light:border-slate-300 bg-slate-900/80 light:bg-slate-100 p-1.5 shadow-md"><div class="media-loading h-44 rounded-xl flex items-center justify-center text-xs text-slate-500">Loading photo…</div><img alt="" class="media-image hidden rounded-xl w-full max-h-80 object-cover cursor-zoom-in">${message.viewOnce && isMine ? '<span class="absolute top-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">View once</span>' : ''}</div>${captionHtml}`;
          }
          break;
        case 'video':
          content = `<div class="media-shell max-w-xs sm:max-w-sm rounded-2xl overflow-hidden border border-slate-700 bg-slate-900/80 p-1.5 shadow-md"><div class="media-loading h-40 rounded-xl flex items-center justify-center text-xs text-slate-500">Loading video…</div><video class="media-video hidden rounded-xl w-full max-h-80" controls playsinline preload="metadata"></video></div>${captionHtml}`;
          break;
        case 'audio':
          content = '<div class="media-shell w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/80 p-3"><div class="text-[10px] text-slate-400 mb-2">Voice message</div><audio class="media-audio w-full" controls preload="metadata"></audio></div>';
          break;
        case 'file':
          content = `<button type="button" class="file-download flex items-center gap-3 max-w-xs sm:max-w-sm rounded-2xl border border-slate-700 bg-slate-900/80 p-3 text-left hover:border-cyan-500/50"><span class="text-2xl">📎</span><span class="min-w-0"><span class="block text-xs font-semibold text-slate-100 truncate">${escapeHtml(message.fileName || 'File')}</span><span class="block text-[10px] text-slate-400">${escapeHtml(formatSize(message.fileSize))} · Tap to download</span></span></button>${captionHtml}`;
          break;
        case 'reel': {
          const reel = message.reel || {};
          const thumb = safeUrl(reel.thumbnail_url);
          const link = safeUrl(reel.source_url);
          content = `<div class="reel-card max-w-xs sm:max-w-sm rounded-2xl overflow-hidden border border-purple-500/30 bg-slate-900/90 shadow-md">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" referrerpolicy="no-referrer" class="w-full max-h-48 object-cover">` : ''}<div class="p-3"><div class="text-[10px] uppercase tracking-wider text-purple-300 font-bold">${escapeHtml(reel.platform || 'Reel')}</div><div class="text-sm font-semibold text-slate-100 mt-0.5 break-words">${escapeHtml(reel.title || 'Shared reel')}</div><div class="flex gap-2 mt-2"><button type="button" class="reel-open px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-200 text-xs font-bold border border-purple-500/30">Watch</button>${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold">Open link</a>` : ''}</div></div></div>`;
          break;
        }
        default:
          content = `<div class="px-4 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed max-w-sm sm:max-w-md shadow-sm whitespace-pre-wrap break-words ${bubbleClass}">${escapeHtml(message.text || '')}</div>`;
      }
      wrapper.innerHTML = `${content}<div class="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-mono"><span>${escapeHtml(message.time || '')}</span>${isMine ? this.statusMarkup(message) : ''}</div>`;
      wrapper.querySelector('.view-once-open')?.addEventListener('click', () => this.openViewOnce(message, wrapper));
      wrapper.querySelector('.reel-open')?.addEventListener('click', () => {
        if (message.reel?.id && state().reels.some((r) => Number(r.id) === Number(message.reel.id))) window.appReels.playReelById(message.reel.id);
        else if (safeUrl(message.reel?.source_url)) window.open(safeUrl(message.reel.source_url), '_blank', 'noopener');
      });
      return wrapper;
    },

    statusMarkup(message) {
      if (message.readByRecipient || message.viewedAt) return '<span class="status-tick font-bold text-cyan-400" title="Seen">✓✓</span>';
      if (message.deliveredAt) return '<span class="status-tick font-bold text-slate-300" title="Delivered">✓✓</span>';
      return '<span class="status-tick font-bold text-slate-400" title="Sent">✓</span>';
    },

    updateMessageStatus(messageId, changes) {
      state().conversations.forEach((conversation) => {
        const msg = (conversation.messages || []).find((item) => Number(item.id) === Number(messageId));
        if (!msg) return;
        Object.assign(msg, changes);
        if (Number(conversation.id) !== Number(state().activeConversationId) || !msg.isMine) return;
        const node = document.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"] .status-tick`);
        if (node) node.outerHTML = this.statusMarkup(msg);
      });
    },

    async hydrateMedia(wrapper, message) {
      const type = message.type;
      if (!['image', 'video', 'audio', 'file'].includes(type) || (message.viewOnce && !message.isMine)) return;
      const mediaId = message.media_id ?? message.mediaId ?? message.media?.id;
      if (type === 'file') {
        wrapper.querySelector('.file-download')?.addEventListener('click', async () => {
          try {
            const blob = await api().fetchMediaBlob(mediaId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = message.fileName || 'download';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          } catch (error) { ui().toast(error.message, 'error'); }
        });
        return;
      }
      const image = wrapper.querySelector('.media-image');
      const video = wrapper.querySelector('.media-video');
      const audio = wrapper.querySelector('.media-audio');
      const loading = wrapper.querySelector('.media-loading');
      if (!mediaId) { if (loading) loading.textContent = 'Media is unavailable'; return; }
      try {
        let objectUrl = mediaObjectUrls.get(Number(mediaId));
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(await api().fetchMediaBlob(mediaId));
          mediaObjectUrls.set(Number(mediaId), objectUrl);
        }
        const stream = document.getElementById('messageStream');
        const stick = stream && nearBottom(stream);
        if (image) {
          image.onload = () => { if (stick) this.scrollToBottom(); };
          image.src = objectUrl;
          image.classList.remove('hidden');
          image.onclick = () => this.showImageViewer(objectUrl);
        }
        if (video) { video.src = objectUrl; video.classList.remove('hidden'); }
        if (audio) audio.src = objectUrl;
        loading?.classList.add('hidden');
      } catch (error) {
        if (loading) loading.textContent = 'Unable to load media';
        console.warn('[AETHERIS] Media load failed:', error.message);
      }
    },

    showImageViewer(url) {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-5 cursor-zoom-out';
      modal.innerHTML = '<img class="max-h-[90vh] max-w-full rounded-2xl object-contain" alt="">';
      modal.querySelector('img').src = url;
      modal.onclick = () => modal.remove();
      document.body.appendChild(modal);
    },

    async openViewOnce(message, wrapper) {
      const button = wrapper.querySelector('.view-once-open');
      if (!button || message.viewedAt) return;
      button.disabled = true;
      button.classList.add('opacity-60', 'cursor-wait');
      try {
        const mediaId = message.media_id ?? message.mediaId ?? message.media?.id;
        if (!mediaId) throw new Error('This photo has no media reference. Reload the conversation.');
        const blob = await api().viewOnceMedia(mediaId);
        message.viewedAt = new Date().toISOString();
        const url = URL.createObjectURL(blob);
        this.showViewOnceImage(url, () => URL.revokeObjectURL(url));
        button.outerHTML = '<div class="max-w-xs sm:max-w-sm rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4 text-xs text-slate-400">✓ Photo viewed</div>';
        if (socket()?.connected) socket().emit('message_read', { conversation_id: message.conversation_id, message_id: message.id });
      } catch (error) {
        button.disabled = false;
        button.classList.remove('opacity-60', 'cursor-wait');
        ui().toast(error.message, 'error');
      }
    },

    showViewOnceImage(url, cleanup) {
      document.getElementById('aetherisViewOnceModal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'aetherisViewOnceModal';
      modal.className = 'fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-5';
      modal.innerHTML = '<div class="relative max-w-3xl max-h-[90vh]"><button id="aetherisViewOnceClose" class="absolute -top-10 right-0 text-white text-2xl">×</button><img id="aetherisViewOnceImage" class="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl" alt="View once photo"></div>';
      document.body.appendChild(modal);
      modal.querySelector('#aetherisViewOnceImage').src = url;
      modal.querySelector('#aetherisViewOnceClose').onclick = () => { cleanup?.(); modal.remove(); };
    },

    // ---------- live events ----------
    async handleIncomingMessage(raw, normalize) {
      const conversationId = Number(raw.conversation_id);
      let conversation = findConversation(conversationId);
      const mine = Number(raw.sender_id) === me();
      if (!conversation) {
        // A chat we do not know yet (e.g. someone just started it): fetch the list instead of dropping the message.
        await this.loadConversations({ quiet: true });
        conversation = findConversation(conversationId);
        if (conversation && !mine && socket()?.connected) socket().emit('message_delivered', { conversation_id: conversationId, message_id: Number(raw.id) });
        return;
      }
      const message = normalize(raw);
      const known = Array.isArray(conversation.messages) && conversation.messages.some((item) => Number(item.id) === Number(message.id));
      if (known) return;
      if (Array.isArray(conversation.messages)) conversation.messages.push(message);
      conversation.lastMessage = { id: message.id, type: message.type, text: message.text, senderId: Number(raw.sender_id), createdAt: raw.created_at };
      const isActive = conversationId === Number(state().activeConversationId);
      if (!mine) {
        if (socket()?.connected) socket().emit('message_delivered', { conversation_id: conversationId, message_id: Number(message.id) });
        if (isActive && chatTabVisible()) this.markConversationRead();
        else conversation.unread = (conversation.unread || 0) + 1;
        this.hideTyping({ conversation_id: conversationId });
      }
      if (isActive && Array.isArray(conversation.messages)) this.appendToActiveStream(message, mine);
      this.renderConversations();
      this.updateTitleBadge();
      if (!mine) window.appNotifs?.refreshBadge?.();
    },

    appendToActiveStream(message, forceScroll) {
      const stream = document.getElementById('messageStream');
      if (!stream) return;
      const stick = forceScroll || nearBottom(stream);
      stream.querySelector('.empty-chat')?.remove();
      this.appendMessageElement(stream, message);
      if (stick) this.scrollToBottom();
      else document.getElementById('scrollToBottomBtn')?.classList.remove('hidden');
      this.renderSharedPanel(this.activeContact());
    },

    handleConversationCreated(conversation) {
      if (!conversation || findConversation(conversation.id)) return;
      state().conversations.unshift(conversation);
      this.renderConversations();
      this.updateTitleBadge();
      if (!pendingCreate) ui().toast(`New chat with ${conversation.name || conversation.handle || 'a user'}`, 'success');
    },

    handleMessagesRead(data) {
      if (!data || Number(data.user_id) === me()) return;
      (data.message_ids || []).forEach((id) => this.updateMessageStatus(id, { readByRecipient: true, deliveredAt: new Date().toISOString() }));
    },

    updateUserPresence(payload, online) {
      const userId = Number(payload?.user_id);
      if (!userId) return;
      let changed = false;
      state().conversations.forEach((conversation) => {
        if (Number(conversation.other_user_id) !== userId) return;
        if (Boolean(conversation.online) === Boolean(online) && online) return;
        conversation.online = Boolean(online);
        if (!online) conversation.lastSeen = new Date().toISOString();
        changed = true;
      });
      if (!changed) return;
      this.renderConversations();
      const active = this.activeContact();
      if (active && Number(active.other_user_id) === userId) this.renderHeader(active);
    },

    markConversationRead() {
      clearTimeout(readTimer);
      readTimer = setTimeout(async () => {
        const conversation = this.activeContact();
        if (!conversation || !chatTabVisible()) return;
        const hadUnread = conversation.unread > 0;
        conversation.unread = 0;
        if (hadUnread) { this.renderConversations(); this.updateTitleBadge(); }
        try { await api().markConversationRead(conversation.id); } catch (error) { console.warn('[AETHERIS] read receipt failed:', error.message); }
      }, 150);
    },

    // ---------- sending ----------
    addLocalMessage(conversation, message) {
      if (!message || !message.id) return;
      if (!Array.isArray(conversation.messages)) conversation.messages = [];
      const exists = conversation.messages.some((item) => Number(item.id) === Number(message.id));
      conversation.lastMessage = { id: message.id, type: message.type, text: message.text, senderId: me(), createdAt: message.created_at };
      if (!exists) {
        conversation.messages.push(message);
        if (Number(conversation.id) === Number(state().activeConversationId)) this.appendToActiveStream(message, true);
      }
      this.renderConversations();
    },

    async sendCurrentMessage() {
      const input = document.getElementById('messageTextInput');
      const text = input.value.trim();
      const conversation = this.activeContact();
      if (!text || !conversation || sending) return;
      sending = true;
      this.stopTyping();
      try {
        const sent = await api().sendMessage(conversation.id, { type: 'text', text });
        input.value = '';
        input.style.height = 'auto';
        const message = sent?.message || sent;
        if (message?.id) this.addLocalMessage(conversation, message);
        else await this.loadMessages(conversation.id);
      } catch (error) { ui().toast(error.message, 'error'); }
      finally { sending = false; input.focus(); }
    },

    handleKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.sendCurrentMessage(); }
    },

    handleTyping(textarea) {
      this.autoResize(textarea);
      const conversation = this.activeContact();
      if (!conversation || !socket()?.connected) return;
      const hasText = textarea.value.trim().length > 0;
      if (hasText && typingConversationId !== conversation.id) {
        if (typingConversationId) socket().emit('typing_stop', { conversation_id: typingConversationId });
        typingConversationId = conversation.id;
        socket().emit('typing_start', { conversation_id: conversation.id });
      } else if (!hasText && typingConversationId) this.stopTyping();
      clearTimeout(typingTimer);
      if (hasText) typingTimer = setTimeout(() => this.stopTyping(), 2500);
    },

    stopTyping() {
      clearTimeout(typingTimer);
      if (typingConversationId && socket()?.connected) socket().emit('typing_stop', { conversation_id: typingConversationId });
      typingConversationId = null;
    },

    showTyping(payload) {
      if (!payload || Number(payload.conversation_id) !== Number(state().activeConversationId) || Number(payload.user_id) === me()) return;
      const indicator = document.getElementById('typingIndicator');
      if (!indicator) return;
      indicator.classList.remove('hidden');
      const author = document.getElementById('typingAuthor');
      if (author) author.textContent = this.activeContact()?.name || 'User';
      clearTimeout(remoteTypingTimer);
      remoteTypingTimer = setTimeout(() => this.hideTyping(), 6000);
    },

    hideTyping(payload) {
      if (payload && payload.conversation_id && Number(payload.conversation_id) !== Number(state().activeConversationId)) return;
      clearTimeout(remoteTypingTimer);
      document.getElementById('typingIndicator')?.classList.add('hidden');
    },

    autoResize(textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`; },

    scrollToBottom() {
      const stream = document.getElementById('messageStream');
      if (stream) stream.scrollTop = stream.scrollHeight;
      document.getElementById('scrollToBottomBtn')?.classList.add('hidden');
    },

    toggleMobileSidebar(open) {
      const sidebar = document.getElementById('chatSidebar');
      const workspace = document.getElementById('viewChatTab');
      if (!sidebar || !workspace) return;
      let backdrop = document.getElementById('mobileChatBackdrop');
      if (!backdrop) {
        backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.id = 'mobileChatBackdrop';
        backdrop.setAttribute('aria-label', 'Close chats drawer');
        backdrop.onclick = () => this.toggleMobileSidebar(false);
        workspace.insertBefore(backdrop, sidebar.nextSibling);
      }
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      sidebar.classList.toggle('-translate-x-full', mobile && !open);
      backdrop.classList.toggle('is-visible', mobile && open);
      document.getElementById('mobileSidebarToggle')?.setAttribute('aria-expanded', String(mobile && open));
      document.body.classList.toggle('overflow-hidden', mobile && open);
    },

    toggleUserInfoPanel() { document.getElementById('chatUserInfoPanel').classList.toggle('hidden'); },

    toggleSearchInChat() {
      const drawer = document.getElementById('chatSearchDrawer');
      drawer.classList.toggle('hidden');
      if (drawer.classList.contains('hidden')) {
        document.getElementById('inChatMessageSearch').value = '';
        this.renderActiveChat(null, { forceBottom: true });
      } else document.getElementById('inChatMessageSearch').focus();
    },

    searchCurrentChatMessages(keyword) {
      const term = keyword.trim().toLowerCase();
      if (!term) { this.renderActiveChat(null, { forceBottom: true }); return; }
      const conversation = this.activeContact();
      const stream = document.getElementById('messageStream');
      stream.innerHTML = '';
      const hits = (conversation?.messages || []).filter((m) => `${m.text || ''} ${m.caption || ''} ${m.fileName || ''} ${m.reel?.title || ''}`.toLowerCase().includes(term));
      if (!hits.length) stream.innerHTML = '<div class="p-6 text-center text-xs text-slate-500">No matching messages in the loaded history.</div>';
      hits.forEach((m) => this.appendMessageElement(stream, m));
    },

    // ---------- block ----------
    async renderBlockButton(conversation) {
      const button = document.getElementById('blockUserButton');
      if (!button) return;
      const paint = () => { button.textContent = conversation.blocked ? 'Unblock this user' : 'Block this user'; };
      paint();
      if (conversation.blocked === undefined) {
        try { conversation.blocked = await api().isBlocked(conversation.other_user_id); paint(); } catch (e) { /* keep default label */ }
      }
    },

    async toggleBlock() {
      const conversation = this.activeContact();
      if (!conversation) return;
      const block = !conversation.blocked;
      if (block && !window.confirm(`Block ${conversation.name || 'this user'}? Neither of you will be able to send messages or call.`)) return;
      try {
        await api().blockUser(conversation.other_user_id, block);
        conversation.blocked = block;
        this.renderBlockButton(conversation);
        ui().toast(block ? 'User blocked' : 'User unblocked', 'success');
      } catch (error) { ui().toast(error.message, 'error'); }
    },

    // ---------- emoji / attachments ----------
    toggleEmojiPicker() { document.getElementById('emojiPickerDrawer').classList.toggle('hidden'); },
    insertEmoji(emoji) { const input = document.getElementById('messageTextInput'); input.value += emoji; input.focus(); document.getElementById('emojiPickerDrawer').classList.add('hidden'); this.handleTyping(input); },
    toggleAttachMenu() { document.getElementById('attachMenuPopover').classList.toggle('hidden'); },

    triggerFileUpload(kind) {
      document.getElementById('attachMenuPopover').classList.add('hidden');
      const input = document.getElementById('mediaFileInput');
      const accept = {
        image: 'image/jpeg,image/png,image/webp',
        video: 'video/mp4,video/webm,video/quicktime',
        file: 'application/pdf,.doc,.docx,audio/mpeg,audio/wav,audio/ogg'
      };
      input.accept = accept[kind] || accept.image;
      input.click();
    },

    handleFileSelected(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) { ui().toast('File is larger than 50 MB.', 'error'); event.target.value = ''; return; }
      if (!this.activeContact()) { ui().toast('Open a conversation first.', 'error'); event.target.value = ''; return; }
      state().pendingUploadFile = file;
      this.openPreviewModal(file);
    },

    openPreviewModal(file) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
      const image = document.getElementById('previewModalImage');
      const video = document.getElementById('previewModalVideo');
      const audio = document.getElementById('previewModalAudio');
      const info = document.getElementById('previewModalFile');
      [image, video, audio, info].forEach((el) => el.classList.add('hidden'));
      if (kind === 'image') { image.src = previewUrl; image.classList.remove('hidden'); }
      else if (kind === 'video') { video.src = previewUrl; video.classList.remove('hidden'); }
      else if (kind === 'audio') { audio.src = previewUrl; audio.classList.remove('hidden'); }
      else { info.textContent = `📎 ${file.name} (${formatSize(file.size)})`; info.classList.remove('hidden'); }
      document.getElementById('viewOnceLabel')?.classList.toggle('hidden', kind !== 'image');
      document.getElementById('previewModalCaption').value = '';
      document.getElementById('uploadProgressBarContainer')?.classList.add('hidden');
      document.getElementById('mediaPreviewModal').classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    },

    closePreviewModal() {
      if (uploading) return;
      document.getElementById('mediaPreviewModal').classList.add('hidden');
      ['previewModalVideo', 'previewModalAudio'].forEach((id) => { const el = document.getElementById(id); el.pause?.(); el.removeAttribute('src'); });
      document.getElementById('previewModalImage').removeAttribute('src');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      state().pendingUploadFile = null;
      document.getElementById('mediaFileInput').value = '';
    },

    async confirmMediaSend() {
      const conversation = this.activeContact();
      const file = state().pendingUploadFile;
      if (!conversation || !file || uploading) return;
      const caption = document.getElementById('previewModalCaption').value.trim();
      const viewOnce = Boolean(document.getElementById('viewOnceCheckbox')?.checked);
      const bar = document.getElementById('uploadProgressBar');
      const pct = document.getElementById('uploadProgressPct');
      const container = document.getElementById('uploadProgressBarContainer');
      const sendButton = document.getElementById('previewSendButton');
      uploading = true;
      if (sendButton) sendButton.disabled = true;
      if (bar) bar.style.width = '0%';
      if (pct) pct.textContent = '0%';
      container?.classList.remove('hidden');
      try {
        const media = await api().uploadMedia(file, (value) => { if (bar) bar.style.width = `${value}%`; if (pct) pct.textContent = `${value}%`; });
        const type = media.file_type || 'image';
        const sent = await api().sendMessage(conversation.id, { type, mediaId: media.media_id, caption, viewOnce: type === 'image' && viewOnce });
        uploading = false;
        this.closePreviewModal();
        this.addLocalMessage(conversation, sent?.message || sent);
      } catch (error) { ui().toast(error.message, 'error'); }
      finally { uploading = false; if (sendButton) sendButton.disabled = false; container?.classList.add('hidden'); }
    },

    // ---------- voice notes ----------
    async startVoiceRecording() {
      const conversation = this.activeContact();
      if (!conversation) return ui().toast('Open a conversation before recording a voice note.', 'error');
      if (voiceRecorder) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return ui().toast('Voice recording is not supported in this browser (needs HTTPS or localhost).', 'error');
      try {
        voiceCancelled = false;
        voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferred = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type));
        voiceRecorder = new MediaRecorder(voiceStream, preferred ? { mimeType: preferred } : undefined);
        voiceChunks = [];
        voiceStartedAt = Date.now();
        voiceRecorder.ondataavailable = (event) => { if (event.data?.size) voiceChunks.push(event.data); };
        voiceRecorder.onstop = async () => {
          const stream = voiceStream;
          voiceStream = null;
          stream?.getTracks().forEach((track) => track.stop());
          const recorder = voiceRecorder;
          voiceRecorder = null;
          clearInterval(voiceTimer);
          const duration = Date.now() - voiceStartedAt;
          if (voiceCancelled) { voiceChunks = []; return; }
          if (duration < 800 || !voiceChunks.length) { voiceChunks = []; ui().toast('Recording too short.', 'error'); return; }
          const mimeType = (recorder?.mimeType || voiceChunks[0].type || 'audio/webm').split(';')[0];
          const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
          const blob = new Blob(voiceChunks, { type: mimeType });
          voiceChunks = [];
          try {
            const uploaded = await api().uploadMedia(new File([blob], `voice-note.${extension}`, { type: mimeType }));
            const sent = await api().sendMessage(conversation.id, { type: 'audio', mediaId: uploaded.media_id });
            this.addLocalMessage(conversation, sent?.message || sent);
          } catch (error) { ui().toast(`Voice note could not be sent: ${error.message}`, 'error'); }
        };
        voiceRecorder.start(250);
        document.getElementById('voiceRecordingBar').classList.remove('hidden');
        const updateTimer = () => {
          const seconds = Math.floor((Date.now() - voiceStartedAt) / 1000);
          document.getElementById('voiceRecTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        };
        updateTimer();
        voiceTimer = setInterval(updateTimer, 250);
        setTimeout(() => { if (voiceRecorder?.state === 'recording') this.finishVoiceRecording(); }, 180000);
      } catch (error) {
        voiceStream?.getTracks().forEach((track) => track.stop());
        voiceStream = null;
        voiceRecorder = null;
        ui().toast(`Microphone access failed: ${error.message}`, 'error');
      }
    },

    cancelVoiceRecording() {
      voiceCancelled = true;
      document.getElementById('voiceRecordingBar').classList.add('hidden');
      if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
      else voiceStream?.getTracks().forEach((track) => track.stop());
    },

    finishVoiceRecording() {
      document.getElementById('voiceRecordingBar').classList.add('hidden');
      if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
    },

    // ---------- calls ----------
    startCallMock(type) { return window.aetherisCall?.start(type, this.activeContact()); },

    // ---------- new chat ----------
    openNewChatModal() { document.getElementById('newChatModal').classList.remove('hidden'); document.getElementById('newChatHandleInput').focus(); },
    closeNewChatModal() { document.getElementById('newChatModal').classList.add('hidden'); },

    async createNewChat() {
      const handleInput = document.getElementById('newChatHandleInput');
      const greetingInput = document.getElementById('newChatGreetingInput');
      const username = handleInput.value.trim();
      const greeting = greetingInput.value.trim();
      if (!username || pendingCreate) return;
      pendingCreate = true;
      try {
        const result = await api().createConversation(username);
        const conversation = result.conversation;
        if (!conversation) throw new Error('Conversation could not be created.');
        let local = findConversation(conversation.id);
        if (!local) { state().conversations.unshift(conversation); local = conversation; }
        state().activeConversationId = local.id;
        this.closeNewChatModal();
        handleInput.value = ''; greetingInput.value = '';
        this.renderConversations();
        await this.loadMessages(local.id);
        if (greeting) {
          const sent = await api().sendMessage(local.id, { type: 'text', text: greeting });
          this.addLocalMessage(local, sent?.message || sent);
        }
      } catch (error) { ui().toast(error.message, 'error'); }
      finally { pendingCreate = false; }
    }
  };
})();
