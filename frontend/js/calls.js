(function () {
  const fallbackIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  let currentCall = null;
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let incomingTimer = null;
  let pendingCandidates = [];
  let iceServers = fallbackIceServers;

  function socket() {
    return window.aetherisSocket?.connection;
  }

  function callRequest(eventName, payload) {
    return new Promise((resolve, reject) => {
      const activeSocket = socket();
      if (!activeSocket?.connected) {
        reject(new Error('Connect to messaging before starting a call.'));
        return;
      }
      const timeout = window.setTimeout(() => reject(new Error('Call signaling timed out.')), 7000);
      activeSocket.emit(eventName, payload, (response) => {
        window.clearTimeout(timeout);
        if (!response || response.success === false) {
          reject(new Error(response?.error?.message || response?.error || 'Call request failed.'));
          return;
        }
        resolve(response.data || {});
      });
    });
  }

  function setStatus(text) {
    const node = document.getElementById('callModalStatus');
    if (node) node.textContent = text;
  }

  function showModal({ incoming = false } = {}) {
    document.getElementById('callIncomingControls')?.classList.toggle('hidden', !incoming);
    document.getElementById('callActiveControls')?.classList.toggle('hidden', incoming);
    document.getElementById('callSimulatorModal')?.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  async function requestLocalMedia(type) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice and video calls require HTTPS or localhost in a supported browser.');
    }
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video'
    });
  }

  function emitSignal(signalType, signal) {
    if (!currentCall) return Promise.reject(new Error('There is no active call.'));
    return callRequest('call_signal', {
      conversation_id: currentCall.conversationId,
      call_id: currentCall.callId,
      to_user_id: currentCall.peerUserId,
      signal_type: signalType,
      signal
    });
  }

  async function flushCandidates() {
    if (!peerConnection?.remoteDescription) return;
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) {
      await peerConnection.addIceCandidate(candidate);
    }
  }

  function createPeerConnection() {
    if (peerConnection) return peerConnection;
    peerConnection = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();
    const remoteVideo = document.getElementById('callRemoteVideo');
    remoteVideo.srcObject = remoteStream;
    remoteVideo.classList.toggle('hidden', currentCall?.type !== 'video');
    document.getElementById('callAudioAvatar')?.classList.toggle('hidden', currentCall?.type === 'video');

    localStream?.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => remoteStream.addTrack(track));
      remoteVideo.play().catch(() => {});
      setStatus('Connected');
    };
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentCall) {
        emitSignal('ice_candidate', event.candidate.toJSON()).catch((error) => {
          console.warn('[AETHERIS] Could not send call network candidate:', error.message);
        });
      }
    };
    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      if (peerConnection.connectionState === 'connected') setStatus('Connected');
      if (peerConnection.connectionState === 'failed') setStatus('Connection failed. A TURN relay may be required on this network.');
      if (peerConnection.connectionState === 'disconnected') setStatus('Reconnecting…');
    };
    const localVideo = document.getElementById('callLocalVideo');
    localVideo.srcObject = localStream;
    localVideo.classList.toggle('hidden', currentCall?.type !== 'video');
    return peerConnection;
  }

  function clearCall() {
    window.clearTimeout(incomingTimer);
    incomingTimer = null;
    peerConnection?.close();
    peerConnection = null;
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    remoteStream = null;
    pendingCandidates = [];
    ['callLocalVideo', 'callRemoteVideo'].forEach((id) => {
      const video = document.getElementById(id);
      if (video) video.srcObject = null;
    });
    currentCall = null;
    document.getElementById('callSimulatorModal')?.classList.add('hidden');
    document.getElementById('callIncomingControls')?.classList.add('hidden');
    document.getElementById('callActiveControls')?.classList.remove('hidden');
  }

  async function start(type, conversation = window.appChat?.activeContact()) {
    if (!conversation || !conversation.other_user_id) {
      window.alert('Select a valid private conversation before calling.');
      return;
    }
    if (currentCall) {
      window.alert('A call is already active.');
      return;
    }
    try {
      try {
        iceServers = await window.aetherisApi.fetchCallIceServers();
      } catch {
        iceServers = fallbackIceServers;
      }
      localStream = await requestLocalMedia(type);
      const result = await callRequest('call_start', {
        conversation_id: Number(conversation.id),
        call_type: type
      });
      currentCall = {
        callId: result.call_id,
        conversationId: Number(conversation.id),
        peerUserId: Number(result.to_user_id),
        type,
        role: 'caller',
        name: conversation.name || conversation.full_name || conversation.handle || 'Private contact'
      };
      document.getElementById('callModalName').textContent = currentCall.name;
      window.appUi.setAvatar(document.getElementById('callModalAvatar'), conversation.other_user_id, conversation.avatar, conversation.name);
      document.getElementById('callTypeLabel').textContent = type === 'video' ? 'Video call' : 'Voice call';
      setStatus('Ringing…');
      showModal();
      createPeerConnection();
      incomingTimer = window.setTimeout(() => {
        if (currentCall?.role === 'caller') {
          setStatus('No answer');
          window.setTimeout(clearCall, 1200);
        }
      }, 45000);
    } catch (error) {
      clearCall();
      window.alert(error.message);
    }
  }

  async function accept() {
    if (!currentCall || currentCall.role !== 'callee') return;
    try {
      try {
        iceServers = await window.aetherisApi.fetchCallIceServers();
      } catch {
        iceServers = fallbackIceServers;
      }
      localStream = await requestLocalMedia(currentCall.type);
      createPeerConnection();
      document.getElementById('callIncomingControls')?.classList.add('hidden');
      document.getElementById('callActiveControls')?.classList.remove('hidden');
      setStatus('Connecting…');
      await emitSignal('accept');
    } catch (error) {
      window.alert(error.message);
      await reject();
    }
  }

  async function reject() {
    if (!currentCall) return;
    try { await emitSignal('reject'); } catch { /* The caller may have disconnected. */ }
    clearCall();
  }

  async function end() {
    if (!currentCall) return;
    try { await emitSignal('end'); } catch { /* Local hang-up still succeeds. */ }
    clearCall();
  }

  async function handleIncoming(invite) {
    if (!invite?.call_id || !invite?.conversation_id || !invite?.caller?.id) return;
    if (currentCall) {
      try {
        await callRequest('call_signal', {
          conversation_id: Number(invite.conversation_id), call_id: invite.call_id,
          to_user_id: Number(invite.caller.id), signal_type: 'reject'
        });
      } catch { /* Busy response is best effort. */ }
      return;
    }
    currentCall = {
      callId: invite.call_id,
      conversationId: Number(invite.conversation_id),
      peerUserId: Number(invite.caller.id),
      type: invite.call_type === 'video' ? 'video' : 'audio',
      role: 'callee',
      name: invite.caller.full_name || invite.caller.username || 'Private contact'
    };
    document.getElementById('callModalName').textContent = currentCall.name;
    window.appUi.setAvatar(document.getElementById('callModalAvatar'), invite.caller.id, invite.caller.avatar, currentCall.name);
    document.getElementById('callTypeLabel').textContent = currentCall.type === 'video' ? 'Incoming video call' : 'Incoming voice call';
    setStatus('Incoming call');
    showModal({ incoming: true });
    incomingTimer = window.setTimeout(() => {
      if (currentCall?.role === 'callee') clearCall();
    }, 45000);
  }

  async function handleSignal(data) {
    if (!currentCall || !data || data.call_id !== currentCall.callId) return;
    if (Number(data.from_user_id) !== currentCall.peerUserId) return;
    try {
      if (data.signal_type === 'accept' && currentCall.role === 'caller') {
        window.clearTimeout(incomingTimer);
        createPeerConnection();
        setStatus('Connecting…');
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await emitSignal('offer', peerConnection.localDescription.toJSON());
      } else if (data.signal_type === 'offer' && currentCall.role === 'callee') {
        await peerConnection.setRemoteDescription(data.signal);
        await flushCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await emitSignal('answer', peerConnection.localDescription.toJSON());
      } else if (data.signal_type === 'answer' && currentCall.role === 'caller') {
        await peerConnection.setRemoteDescription(data.signal);
        await flushCandidates();
      } else if (data.signal_type === 'ice_candidate' && data.signal) {
        const candidate = new RTCIceCandidate(data.signal);
        if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(candidate);
        else pendingCandidates.push(candidate);
      } else if (data.signal_type === 'reject') {
        setStatus('Call declined');
        window.setTimeout(clearCall, 1000);
      } else if (data.signal_type === 'end') {
        clearCall();
      }
    } catch (error) {
      console.error('[AETHERIS] Call negotiation failed:', error);
      setStatus('Could not establish the call. Check network access or TURN configuration.');
    }
  }

  function toggleMute() {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const button = document.getElementById('callMuteButton');
    if (button) {
      button.title = track.enabled ? 'Mute microphone' : 'Unmute microphone';
      button.innerHTML = `<i data-lucide="${track.enabled ? 'mic' : 'mic-off'}" class="w-5 h-5"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function toggleCamera() {
    const track = localStream?.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
  }

  window.aetherisCall = { start, accept, reject, end, handleIncoming, handleSignal, toggleMute, toggleCamera };
})();
