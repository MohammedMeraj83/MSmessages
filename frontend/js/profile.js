(function () {
  function setProfile(user) {
    if (!user) return;
    const name = user.name || user.displayName || '';
    const handle = user.handle || '';
    const avatar = user.avatar || user.avatarUrl || '';
    const nameNode = document.getElementById('profilePageName');
    const handleNode = document.getElementById('profilePageHandle');
    if (nameNode) nameNode.innerText = name;
    if (handleNode) handleNode.innerText = handle;
    ['profilePageAvatar', 'currentUserAvatar'].forEach((id) => {
      window.appUi.setAvatar(document.getElementById(id), user.id, avatar, name);
    });
    const nameInput = document.getElementById('profileDisplayName');
    const handleInput = document.getElementById('profileHandle');
    const bioInput = document.getElementById('profileBio');
    const bioNode = document.getElementById('profilePageBio');
    if (nameInput) nameInput.value = name;
    if (handleInput) handleInput.value = handle;
    if (bioInput) bioInput.value = user.bio || '';
    if (bioNode) bioNode.textContent = user.bio || '';
  }

  window.appProfile = {
    render: setProfile,
    init() {
      const button = document.getElementById('saveProfileButton');
      if (button) button.addEventListener('click', () => this.update());
      const avatarButton = document.getElementById('changeProfilePhotoButton');
      const avatarInput = document.getElementById('profileAvatarInput');
      if (avatarButton && avatarInput) avatarButton.addEventListener('click', () => avatarInput.click());
      if (avatarInput) avatarInput.addEventListener('change', (event) => this.uploadAvatar(event));
    },
    async uploadAvatar(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
        const uploaded = await window.aetherisApi.uploadMedia(file);
        const result = await window.aetherisApi.updateProfile({ avatar: `/api/media/${uploaded.media_id}` });
        const updatedUser = result.user || result;
        window.aetherisState.currentUser = updatedUser;
        setProfile(updatedUser);
      } catch (error) {
        window.alert(error.message);
      } finally {
        event.target.value = '';
      }
    },
    async update() {
      const profile = {
        name: document.getElementById('profileDisplayName').value,
        handle: document.getElementById('profileHandle').value,
        bio: document.getElementById('profileBio').value
      };
      try {
        const response = await window.aetherisApi.updateProfile(profile);
        const user = response.user || response;
        window.aetherisState.currentUser = user;
        setProfile(user);
      } catch (error) {
        window.alert(error.message);
      }
    }
  };
})();