(function () {
  let refreshTimer = null;

  function paintBadge(unread) {
    const badge = document.getElementById('notificationUnreadCount');
    const dot = document.getElementById('notifUnreadDot');
    if (badge) {
      badge.textContent = unread ? `${unread} new` : '';
      badge.classList.toggle('hidden', unread === 0);
    }
    dot?.classList.toggle('hidden', unread === 0);
  }

  window.appNotifs = {
    async toggleModal() {
      const dropdown = document.getElementById('notifDropdown');
      if (dropdown) dropdown.classList.toggle('hidden');
      if (dropdown && !dropdown.classList.contains('hidden')) await this.load();
    },
    // Debounced: keeps the red dot up to date without opening the dropdown.
    refreshBadge() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        if (!window.aetherisApi.hasToken()) return;
        try {
          const { unread } = await window.aetherisApi.fetchNotificationsSummary();
          paintBadge(unread);
        } catch (error) { /* badge is best-effort */ }
      }, 400);
    },
    async markAllRead() {
      try {
        await window.aetherisApi.markAllNotificationsRead();
        await this.load();
      } catch (error) { window.appUi.toast(error.message, 'error'); }
    },
    async load() {
      const list = document.getElementById('notificationsList');
      if (!list || !window.aetherisApi.hasToken()) return;
      try {
        const { notifications, unread } = await window.aetherisApi.fetchNotificationsSummary();
        paintBadge(unread);
        list.replaceChildren();
        if (!notifications.length) {
          list.textContent = 'No notifications yet.';
          return;
        }
        notifications.forEach((notification) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = `w-full text-left py-3 border-b border-slate-800/60 last:border-0 ${notification.is_read ? 'opacity-60' : ''}`;
          const title = document.createElement('span');
          title.className = 'block font-semibold text-slate-200 light:text-slate-800';
          title.textContent = notification.title;
          const body = document.createElement('span');
          body.className = 'block mt-1 text-[11px] text-slate-400';
          body.textContent = notification.body || '';
          const time = document.createElement('span');
          time.className = 'block mt-1 text-[10px] text-slate-500';
          time.textContent = notification.created_at ? new Date(notification.created_at).toLocaleString() : '';
          item.append(title, body, time);
          item.onclick = async () => {
            if (notification.is_read) return;
            await window.aetherisApi.markNotificationRead(notification.id);
            this.load();
          };
          list.appendChild(item);
        });
      } catch (error) {
        list.textContent = error.message || 'Notifications could not be loaded.';
      }
    }
  };
})();
