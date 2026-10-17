(function () {
  window.aetherisState = {
    currentUser: null,
    conversations: [],
    reels: [],
    activeConversationId: null,
    currentFilter: 'all',
    pendingUploadFile: null,
    pendingReelId: null,
    readAcknowledged: new Set()
  };

  window.appUi = {
    toast(message, kind = 'info') {
      let box = document.getElementById('aetherisToasts');
      if (!box) {
        box = document.createElement('div');
        box.id = 'aetherisToasts';
        box.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none';
        document.body.appendChild(box);
      }
      const toast = document.createElement('div');
      const color = kind === 'error' ? 'bg-rose-600' : kind === 'success' ? 'bg-emerald-600' : 'bg-slate-700';
      toast.className = `${color} text-white text-xs font-medium px-4 py-2 rounded-xl shadow-lg max-w-sm text-center`;
      toast.textContent = String(message || 'Something went wrong');
      box.appendChild(toast);
      setTimeout(() => toast.remove(), kind === 'error' ? 5000 : 3000);
    },
    avatarFallback(name) {
      const initial = (String(name || '?').trim()[0] || '?').toUpperCase().replace(/[<>&"']/g, '?');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#0e7490"/><text x="48" y="64" font-size="44" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="white">${initial}</text></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
    async setAvatar(img, userId, reference, name) {
      if (!img) return;
      const fallback = this.avatarFallback(name);
      img.onerror = () => { img.onerror = null; img.src = fallback; };
      img.src = fallback;
      if (!reference) return;
      try {
        if (String(reference).startsWith('/api/media/')) {
          const url = await window.aetherisApi.resolveAvatar(userId, reference);
          if (url) img.src = url;
        } else if (/^https?:\/\//i.test(reference)) img.src = reference;
      } catch (e) { /* keep initials */ }
    },
    formatLastSeen(iso) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
      if (days <= 0) return `today at ${time}`;
      if (days === 1) return `yesterday at ${time}`;
      return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
    }
  };

  window.appNav = {
    activeTab: 'chat',
    switchTab(tab) {
      this.activeTab = tab;
      window.appChat?.toggleMobileSidebar(false);
      ['chat', 'reels', 'security', 'profile'].forEach((name) => {
        const view = document.getElementById(`view${name[0].toUpperCase()}${name.slice(1)}Tab`);
        if (view) view.classList.toggle('hidden', name !== tab);
      });
      ['Chat', 'Reels', 'Security'].forEach((name) => {
        const button = document.getElementById(`headerTab${name}`);
        if (!button) return;
        button.className = name.toLowerCase() === tab
          ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-cyan-500 text-slate-950 shadow transition-all'
          : 'px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-all';
      });
      ['Chat', 'Reels', 'Security', 'Profile'].forEach((name) => {
        const button = document.getElementById(`mobileNav${name}`);
        if (button) button.className = `flex flex-col items-center gap-1 ${name.toLowerCase() === tab ? 'text-cyan-400' : 'text-slate-400'}`;
      });
      if (tab === 'chat') window.appChat?.markConversationRead();
      if (tab === 'reels') window.appReels.initAutoplay();
      else window.appReels.pauseAllVideos();
      if (window.lucide) window.lucide.createIcons();
    }
  };

  window.appTheme = {
    isDark: true,
    init() {
      this.setTheme(localStorage.getItem('aetheris_theme') !== 'light');
    },
    toggle() { this.setTheme(!this.isDark); },
    setTheme(dark) {
      this.isDark = Boolean(dark);
      document.documentElement.classList.toggle('dark', this.isDark);
      document.documentElement.classList.toggle('light', !this.isDark);
      localStorage.setItem('aetheris_theme', this.isDark ? 'dark' : 'light');
      if (window.lucide) window.lucide.createIcons();
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.appAuth.init();
    window.appTheme.init();
    window.appProfile.init();
    window.appSecurity.init();
    window.appChat.init();
    window.appChat.renderConversations();
    window.appChat.renderActiveChat();
    window.appReels.renderFeed();
    if (window.lucide) window.lucide.createIcons();

    // Restore the existing login session after all modules are ready.
    window.appAuth.restoreSession();

    const isTyping = (target) => target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('globalSearchInput')?.focus();
        return;
      }
      if (window.appNav.activeTab !== 'reels' || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const modalOpen = !document.getElementById('sendReelModal')?.classList.contains('hidden') || !document.getElementById('addReelModal')?.classList.contains('hidden');
      if (modalOpen) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); window.appReels.nextReel(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); window.appReels.prevReel(); }
      if (event.key === ' ') { event.preventDefault(); window.appReels.togglePlayCurrent(); }
      if (event.key.toLowerCase() === 's' && window.aetherisState.reels.length) {
        const reel = window.appReels.currentReel();
        if (reel) window.appReels.openSendModal(reel.id);
      }
    });
    document.getElementById('globalSearchInput')?.addEventListener('input', (event) => {
      window.appNav.switchTab('chat');
      window.appChat.filterConversations(event.target.value);
    });

    const sidebarToggle = document.getElementById('mobileSidebarToggle');
    if (sidebarToggle) sidebarToggle.onclick = () => {
      const sidebar = document.getElementById('chatSidebar');
      window.appChat.toggleMobileSidebar(sidebar?.classList.contains('-translate-x-full'));
    };
    window.addEventListener('resize', () => window.appChat.toggleMobileSidebar(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') window.appChat.toggleMobileSidebar(false);
    });
    document.addEventListener('click', (event) => {
      const dropdownButton = document.getElementById('notifDropdownBtn');
      const dropdown = document.getElementById('notifDropdown');
      if (dropdownButton && dropdown && !dropdownButton.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.classList.add('hidden');
      }
      const attachMenu = document.getElementById('attachMenuPopover');
      if (attachMenu && !attachMenu.classList.contains('hidden') && !event.target.closest('button[onclick*="toggleAttachMenu"]') && !attachMenu.contains(event.target)) {
        attachMenu.classList.add('hidden');
      }
    });
  });
})();