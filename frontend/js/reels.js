(function () {
  const state = () => window.aetherisState;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const listFrom = (result) => Array.isArray(result) ? result : (result && Array.isArray(result.reels) ? result.reels : []);

  const safeUrl = (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : '');
  const isDirectVideo = (url) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);

  function youtubeEmbed(url) {
    try {
      const u = new URL(url);
      let id = '';
      if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1);
      else if (u.hostname.includes('youtube.com')) id = u.searchParams.get('v') || (u.pathname.match(/\/(shorts|embed)\/([\w-]{6,})/) || [])[2] || '';
      return /^[\w-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?playsinline=1` : '';
    } catch (e) { return ''; }
  }

  function prepare(reel) {
    const source = safeUrl(reel.source_url);
    const embed = safeUrl(reel.embed_url);
    return {
      ...reel,
      videoUrl: isDirectVideo(source) ? source : (isDirectVideo(embed) ? embed : ''),
      iframeUrl: embed && !isDirectVideo(embed) ? embed : '',
      poster: safeUrl(reel.thumbnail_url),
      link: source
    };
  }

  window.appReels = {
    currentReel() {
      const container = document.getElementById('reelsScrollContainer');
      if (!container || !container.clientHeight) return null;
      return state().reels[Math.round(container.scrollTop / container.clientHeight)] || null;
    },
    togglePlayCurrent() {
      const container = document.getElementById('reelsScrollContainer');
      const index = Math.round(container.scrollTop / container.clientHeight);
      const video = container.querySelectorAll('.reel-item')[index]?.querySelector('video');
      if (!video) return;
      if (video.paused) video.play().catch(() => {}); else video.pause();
    },
    openAddModal() { document.getElementById('addReelModal').classList.remove('hidden'); document.getElementById('addReelUrl').focus(); },
    closeAddModal() { document.getElementById('addReelModal').classList.add('hidden'); },
    async submitReel() {
      const url = document.getElementById('addReelUrl').value.trim();
      const title = document.getElementById('addReelTitle').value.trim();
      const thumbnail = document.getElementById('addReelThumb').value.trim();
      if (!safeUrl(url)) return window.appUi.toast('Enter a valid http(s) link.', 'error');
      if (!title) return window.appUi.toast('Give the reel a title.', 'error');
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* validated above */ }
      const platform = /youtu/.test(host) ? 'youtube' : /instagram/.test(host) ? 'instagram' : /tiktok/.test(host) ? 'tiktok' : (host.split('.')[0] || 'web');
      const payload = { title, source_url: url, platform };
      const embed = youtubeEmbed(url);
      if (embed) payload.embed_url = embed;
      if (safeUrl(thumbnail)) payload.thumbnail_url = thumbnail;
      try {
        await window.aetherisApi.createReel(payload);
        ['addReelUrl', 'addReelTitle', 'addReelThumb'].forEach((id) => { document.getElementById(id).value = ''; });
        this.closeAddModal();
        await this.loadFeed();
        const container = document.getElementById('reelsScrollContainer');
        container.scrollTop = container.scrollHeight;
        window.appUi.toast('Reel added', 'success');
      } catch (error) { window.appUi.toast(error.message, 'error'); }
    },
    async loadFeed() {
      const container = document.getElementById('reelsScrollContainer');
      try {
        const response = await window.aetherisApi.fetchReels();
        state().reels = listFrom(response).map(prepare);
        this.renderFeed();
      } catch (error) {
        container.innerHTML = `<div class="flex h-full items-center justify-center p-6 text-center text-xs text-rose-400">${escapeHtml(error.message)}</div>`;
      }
    },
    renderFeed() {
      const container = document.getElementById('reelsScrollContainer');
      if (!container) return;
      container.innerHTML = '';
      if (!state().reels.length) {
        container.innerHTML = '<div class="flex h-full flex-col gap-3 items-center justify-center p-6 text-center text-xs text-slate-400">No reels yet. Add a reel link to get started.</div>';
        return;
      }
      state().reels.forEach((reel, index) => {
        const item = document.createElement('div');
        item.className = 'reel-item relative w-full h-full flex flex-col justify-between p-4 sm:p-6 bg-slate-950';
        item.dataset.index = index;
        const id = escapeHtml(reel.id);
        const media = reel.videoUrl
          ? `<video loop playsinline muted preload="metadata" class="absolute inset-0 w-full h-full object-contain bg-black z-0" ${reel.poster ? `poster="${escapeHtml(reel.poster)}"` : ''} src="${escapeHtml(reel.videoUrl)}"></video>`
          : reel.iframeUrl
            ? `<iframe src="${escapeHtml(reel.iframeUrl)}" class="absolute inset-0 w-full h-full z-0 border-0 bg-black" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
            : `<div class="absolute inset-0 z-0 bg-gradient-to-br from-purple-900 to-slate-950 flex items-center justify-center">${reel.poster ? `<img src="${escapeHtml(reel.poster)}" alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover opacity-70">` : ''}</div>`;
        const controlsTop = reel.iframeUrl ? 'pointer-events-none' : '';
        item.innerHTML = `${media}<div class="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80 pointer-events-none z-10"></div><div class="relative z-20 flex items-center justify-between text-white ${controlsTop}"><div class="flex items-center gap-2"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider bg-purple-500/80 backdrop-blur-md uppercase">${escapeHtml(reel.platform || 'Reel')}</span><span class="text-xs text-slate-300 font-mono">${String(index + 1).padStart(2, '0')} / ${String(state().reels.length).padStart(2, '0')}</span></div>${reel.videoUrl ? '<button onclick="window.appReels.toggleSound(this)" class="p-2 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/70"><i data-lucide="volume-x" class="w-4 h-4"></i></button>' : ''}</div><div class="absolute right-3 bottom-20 z-20 flex flex-col items-center gap-4"><button onclick="window.appReels.openSendModal('${id}')" class="flex flex-col items-center gap-1 group"><div class="w-11 h-11 rounded-full bg-gradient-to-tr from-cyan-500 to-sky-400 text-slate-950 flex items-center justify-center shadow-lg shadow-cyan-500/30 group-hover:scale-110 transition"><i data-lucide="send" class="w-5 h-5 fill-slate-950"></i></div><span class="text-[11px] font-bold text-cyan-300 drop-shadow">Send</span></button>${reel.link ? `<a href="${escapeHtml(reel.link)}" target="_blank" rel="noopener noreferrer" class="flex flex-col items-center gap-1 group"><div class="w-11 h-11 rounded-full bg-slate-900/70 backdrop-blur-md flex items-center justify-center text-white group-hover:scale-110 transition"><i data-lucide="external-link" class="w-5 h-5"></i></div><span class="text-[11px] font-semibold text-white drop-shadow">Open</span></a>` : ''}</div><div class="relative z-20 text-white space-y-2 max-w-[80%] pointer-events-none"><h3 class="text-sm font-bold text-slate-100 drop-shadow">${escapeHtml(reel.title || '')}</h3></div>`;
        container.appendChild(item);
      });
      if (window.lucide) window.lucide.createIcons();
    },
    initAutoplay() {
      const container = document.getElementById('reelsScrollContainer');
      if (!container) return;
      this.observer?.disconnect();
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const video = entry.target.querySelector('video');
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) video.play().catch(() => {});
          else video.pause();
        });
      }, { root: container, threshold: [0, 0.6, 1] });
      container.querySelectorAll('.reel-item').forEach((item) => this.observer.observe(item));
    },
    pauseAllVideos() {
      this.observer?.disconnect();
      document.querySelectorAll('#reelsScrollContainer video').forEach((video) => video.pause());
    },
    toggleSound(button) {
      const video = button.closest('.reel-item')?.querySelector('video');
      if (!video) return;
      video.muted = !video.muted;
      button.innerHTML = video.muted ? '<i data-lucide="volume-x" class="w-4 h-4"></i>' : '<i data-lucide="volume-2" class="w-4 h-4"></i>';
      if (window.lucide) window.lucide.createIcons();
    },
    toggleLike(reelId, button) {
      const reel = state().reels.find((item) => String(item.id) === String(reelId));
      if (!reel) return;
      reel.liked = !reel.liked;
      button.querySelector('i').classList.toggle('fill-rose-500', reel.liked);
      button.querySelector('i').classList.toggle('text-rose-500', reel.liked);
    },
    toggleSave(reelId, button) {
      const reel = state().reels.find((item) => String(item.id) === String(reelId));
      if (!reel) return;
      reel.saved = !reel.saved;
      button.querySelector('i').classList.toggle('fill-amber-400', reel.saved);
      button.querySelector('i').classList.toggle('text-amber-400', reel.saved);
    },
    nextReel() {
      const container = document.getElementById('reelsScrollContainer');
      container.scrollBy({ top: container.clientHeight, behavior: 'smooth' });
    },
    prevReel() {
      const container = document.getElementById('reelsScrollContainer');
      container.scrollBy({ top: -container.clientHeight, behavior: 'smooth' });
    },
    playSpecificReel(index) {
      window.appNav.switchTab('reels');
      const container = document.getElementById('reelsScrollContainer');
      container.scrollTop = index * container.clientHeight;
    },
    playReelById(reelId) {
      const index = state().reels.findIndex((item) => String(item.id) === String(reelId));
      if (index >= 0) this.playSpecificReel(index);
    },
    openSendModal(reelId) {
      state().pendingReelId = reelId;
      const list = document.getElementById('reelSendContactList');
      list.innerHTML = '';
      state().conversations.forEach((conversation) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800 cursor-pointer border border-slate-800 transition';
        row.innerHTML = `<div class="flex items-center gap-3"><img alt="" class="w-8 h-8 rounded-full object-cover"><div><p class="text-xs font-bold text-white">${escapeHtml(conversation.name || '')}</p><p class="text-[10px] text-slate-400 font-mono">${escapeHtml(conversation.handle || '')}</p></div></div><button class="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-400 text-xs font-bold border border-cyan-500/30">Dispatch</button>`;
        window.appUi.setAvatar(row.querySelector('img'), conversation.other_user_id, conversation.avatar, conversation.name);
        row.onclick = () => this.sendReelToContact(reelId, conversation.id);
        list.appendChild(row);
      });
      if (!state().conversations.length) list.innerHTML = '<p class="p-4 text-center text-xs text-slate-400">No conversations available.</p>';
      document.getElementById('sendReelModal').classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    },
    closeSendModal() { document.getElementById('sendReelModal').classList.add('hidden'); },
    async sendReelToContact(reelOrId, conversationId) {
      const reelId = typeof reelOrId === 'object' ? reelOrId.id : reelOrId;
      const reel = state().reels.find((item) => String(item.id) === String(reelId));
      if (!reel) return;
      try {
        const sent = await window.aetherisApi.sendMessage(conversationId, { type: 'reel', reelId: reel.id });
        this.closeSendModal();
        state().activeConversationId = conversationId;
        window.appNav.switchTab('chat');
        const conversation = state().conversations.find((item) => Number(item.id) === Number(conversationId));
        if (conversation?.messages) window.appChat.addLocalMessage(conversation, sent?.message || sent);
        window.appChat.openConversation(conversationId);
        window.appUi.toast('Reel sent', 'success');
      } catch (error) {
        window.appUi.toast(error.message, 'error');
      }
    }
  };
})();