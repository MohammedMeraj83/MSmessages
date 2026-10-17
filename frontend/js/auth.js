(function () {
  function initAuthCanvas() {
    const canvas = document.getElementById('authCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    const particles = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.5 ? '#06b6d4' : '#8b5cf6'
    }));

    function render() {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const distance = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
          if (distance < 120) {
            ctx.strokeStyle = `rgba(6, 182, 212, ${0.15 * (1 - distance / 120)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < 0 || particle.x > width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > height) particle.vy *= -1;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      window.requestAnimationFrame(render);
    }

    render();
    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });
  }

  function showServiceError(error) {
    window.alert(error instanceof Error ? error.message : 'The request could not be completed.');
  }

  function openWorkspace(user) {
    if (!user || typeof user !== 'object') throw new Error('The server returned no user profile.');
    window.aetherisState.currentUser = user;
    document.getElementById('authScreen').classList.add('opacity-0', 'pointer-events-none');
    window.setTimeout(() => document.getElementById('authScreen').classList.add('hidden'), 500);
    window.appProfile.render(user);
    window.appAuth.scheduleExpiry();
    window.appNotifs?.refreshBadge?.();
    window.appChat.loadConversations();
    window.appReels.loadFeed();
  }

  window.addEventListener('aetheris:auth-invalid', () => {
    // 401 while logged in = token expired/revoked. (A 401 on the login form itself has no current user.)
    window.appAuth.forceLogout('Your session expired. Please sign in again.');
  });

  window.appAuth = {
    async restoreSession() {
      if (!window.aetherisApi.hasToken()) return;
      try {
        const result = await this.fetchCurrentUser();
        window.aetherisState.currentUser = result.user;
        // After a page refresh the socket must be reconnected with the stored token.
        window.aetherisApi.connectSocket(sessionStorage.getItem('aetheris_access_token'));
        openWorkspace(result.user);
      } catch (error) {
        sessionStorage.removeItem('aetheris_access_token');
        console.warn('[AETHERIS] Stored session is no longer valid:', error.message);
      }
    },
    scheduleExpiry() {
      clearTimeout(this.expiryTimer);
      try {
        const token = sessionStorage.getItem('aetheris_access_token');
        const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const ms = claims.exp * 1000 - Date.now();
        if (ms > 0 && ms < 2147483000) this.expiryTimer = setTimeout(() => this.forceLogout('Your session expired. Please sign in again.'), ms);
      } catch (e) { /* token without readable expiry: rely on 401 handling */ }
    },
    resetWorkspace() {
      clearTimeout(this.expiryTimer);
      window.aetherisState.currentUser = null;
      window.aetherisState.reels = [];
      window.aetherisSocket?.disconnect();
      window.appChat?.reset();
      window.appReels?.renderFeed();
      ['loginPassword', 'signupPass', 'signupConfirm'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('notifUnreadDot')?.classList.add('hidden');
      document.getElementById('notifDropdown')?.classList.add('hidden');
      window.appNav.switchTab('chat');
      document.getElementById('authScreen').classList.remove('hidden');
      window.setTimeout(() => document.getElementById('authScreen').classList.remove('opacity-0', 'pointer-events-none'), 10);
    },
    forceLogout(message) {
      if (!window.aetherisState.currentUser) return;
      sessionStorage.removeItem('aetheris_access_token');
      this.resetWorkspace();
      if (message) window.appUi.toast(message, 'error');
    },
    init() {
      initAuthCanvas();
      const loginTab = document.getElementById('tabLoginBtn');
      const signupTab = document.getElementById('tabSignupBtn');
      const loginForm = document.getElementById('loginForm');
      const signupForm = document.getElementById('signupForm');

      loginTab.onclick = () => {
        loginTab.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-cyan-400 text-cyan-400 transition-colors';
        signupTab.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors';
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
      };
      signupTab.onclick = () => {
        signupTab.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-purple-400 text-purple-400 transition-colors';
        loginTab.className = 'flex-1 pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 transition-colors';
        signupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
      };
    },
    togglePassword(inputId) {
      const input = document.getElementById(inputId);
      input.type = input.type === 'password' ? 'text' : 'password';
    },
    async quickLogin(name, handle, avatar) {
      void name;
      void handle;
      void avatar;
      showServiceError(new Error('Demo accounts are not configured. Create an identity or use your registered credentials.'));
    },
    async handleLogin() {
      try {
        const user = await window.aetherisApi.login({
          username: document.getElementById('loginUsername').value,
          password: document.getElementById('loginPassword').value
        });
        openWorkspace(user.user || user);
      } catch (error) {
        showServiceError(error);
      }
    },
    async handleSignup() {
      const password = document.getElementById('signupPass').value;
      if (password !== document.getElementById('signupConfirm').value) {
        window.alert('Passkeys do not match.');
        return;
      }
      try {
        const user = await window.aetherisApi.signup({
          name: document.getElementById('signupName').value,
          handle: document.getElementById('signupHandle').value,
          email: document.getElementById('signupEmail').value,
          password
        });
        openWorkspace(user.user || user);
      } catch (error) {
        showServiceError(error);
      }
    },
    completeLogin(user = window.aetherisState.currentUser) {
      openWorkspace(user);
    },
    async fetchCurrentUser() {
      return window.aetherisApi.fetchCurrentUser();
    },
    async logout() {
      // The server call may fail (expired token, offline): the local sign-out must happen regardless.
      try { await window.aetherisApi.logout(); } catch (error) { console.warn('[AETHERIS] logout request failed:', error.message); }
      sessionStorage.removeItem('aetheris_access_token');
      this.resetWorkspace();
    }
  };
})();