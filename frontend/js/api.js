(function () {
    "use strict";

    const API_ROOT = "/api";
    const TOKEN_KEY = "aetheris_access_token";
    const avatarObjectUrls = new Map();

    // =========================================================
    // TOKEN HELPERS
    // =========================================================

    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY);
    }

    function saveToken(token) {
        if (token) {
            sessionStorage.setItem(TOKEN_KEY, token);
        }
    }

    function clearToken() {
        sessionStorage.removeItem(TOKEN_KEY);
    }

    function hasToken() {
        return Boolean(getToken());
    }

    // =========================================================
    // AUTHORIZED FETCH
    // =========================================================

    async function authorizedFetch(path, options = {}) {
        const headers = new Headers(options.headers || {});
        const token = getToken();

        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }

        if (
            options.body &&
            !(options.body instanceof FormData) &&
            !headers.has("Content-Type")
        ) {
            headers.set("Content-Type", "application/json");
        }

        return fetch(`${API_ROOT}${path}`, {
            ...options,
            headers
        });
    }

    async function callApi(path, options = {}) {
        const response = await authorizedFetch(path, options);

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message =
                payload?.error?.message ||
                payload?.message ||
                `Request failed (${response.status})`;

            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;

            if (response.status === 401) {
                clearToken();

                window.dispatchEvent(
                    new CustomEvent("aetheris:auth-invalid")
                );
            }

            throw error;
        }

        return payload?.data ?? payload;
    }

    // =========================================================
    // NORMALIZERS
    // =========================================================

    function normalizeUser(user) {
        if (!user) return user;

        const username =
            user.username ||
            user.handle ||
            "";

        return {
            ...user,

            name:
                user.full_name ||
                user.name ||
                user.displayName ||
                "",

            handle:
                username &&
                !username.startsWith("@")
                    ? `@${username}`
                    : username,

            avatar:
                user.avatar ||
                user.avatarUrl ||
                ""
        };
    }

    function normalizeConversation(item) {
        const username =
            item.other_username ||
            item.handle ||
            "";

        return {
            ...item,

            id: Number(item.id),

            name:
                item.other_full_name ||
                item.name ||
                username,

            handle:
                username &&
                !username.startsWith("@")
                    ? `@${username}`
                    : username,

            avatar:
                item.other_avatar ||
                item.avatar ||
                "",

            online: Boolean(
                item.other_is_online ??
                item.online
            ),

            lastSeen:
                item.other_last_seen ||
                item.lastSeen ||
                "",

            bio: item.other_bio || item.bio || "",

            unread: Number(item.unread_count ?? item.unread ?? 0),

            hasReels: Boolean(item.has_reels ?? item.hasReels),

            lastMessage: item.last_message_id
                ? {
                      id: Number(item.last_message_id),
                      type: item.last_message_type || "text",
                      text: item.last_message_text || "",
                      senderId: Number(item.last_message_sender_id),
                      createdAt: item.last_message_at || null
                  }
                : null
        };
    }

    function normalizeMessage(item) {
        if (!item) return item;

        const media = item.media || null;

        const currentUserId =
            window.aetherisState?.currentUser?.id;

        const mine =
            Number(item.sender_id) ===
            Number(currentUserId);

        return {
            ...item,

            id: Number(item.id),

            conversationId:
                Number(item.conversation_id),

            sender:
                mine ? "me" : "them",

            isMine: mine,

            type:
                item.message_type ||
                item.type ||
                "text",

            text:
                item.message_text ||
                item.text ||
                "",

            mediaUrl:
                media?.media_url ||
                item.mediaUrl ||
                "",

            mediaId:
                media?.id ||
                item.media_id ||
                null,

            media_id:
                item.media_id ??
                media?.id ??
                item.mediaId ??
                null,

            caption:
                (item.message_type || item.type) === "text"
                    ? ""
                    : item.message_text || item.caption || "",

            fileName: media?.original_name || "",
            fileSize: media?.file_size || 0,
            mimeType: media?.mime_type || "",
            reel: item.reel || null,

            viewOnce:
                Boolean(
                    item.view_once ??
                    item.viewOnce
                ),

            viewedAt:
                item.viewed_at ||
                item.viewedAt ||
                null,

            deliveredAt:
                item.delivered_at ||
                item.deliveredAt ||
                null,

            readByRecipient:
                Boolean(
                    item.is_read_by_recipient ??
                    item.readByRecipient
                ),

            time: item.created_at
                ? new Date(
                      item.created_at
                  ).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                  })
                : ""
        };
    }

    // =========================================================
    // SOCKET
    // =========================================================

    function getSocket() {
        return window.aetherisSocket?.connection || null;
    }

    function connectSocket(token) {
        if (!token) {
            console.warn(
                "[AETHERIS] No JWT token for Socket.IO"
            );
            return null;
        }

        const socketApi = window.aetherisSocket;

        if (!socketApi || typeof window.io !== "function") {
            console.error(
                "[AETHERIS] Socket.IO instance not found."
            );
            return null;
        }

        try {
            let socket = getSocket();

            if (!socket) {
                socket = socketApi.connect(
                    window.location.origin,
                    {
                        auth: { token },
                        transports: ["polling", "websocket"],
                        autoConnect: false
                    }
                );
            }

            socket.auth = {
                token: token
            };

            setupSocketEvents();

            if (!socket.connected && !socket.active) {
                socket.connect();
            }

            return socket;
        } catch (error) {
            console.error(
                "[AETHERIS] Socket connection failed:",
                error
            );

            return null;
        }
    }

    // =========================================================
    // SOCKET EVENTS
    // =========================================================

    function setupSocketEvents() {
        const socket = getSocket();

        if (!socket) return;

        // Avoid duplicate listeners
        socket.off("connect");
        socket.off("disconnect");
        socket.off("connect_error");
        socket.off("message_received");
        socket.off("message_delivered");
        socket.off("message_read");
        socket.off("messages_read");
        socket.off("conversation_created");
        socket.off("typing_start");
        socket.off("typing_stop");
        socket.off("user_online");
        socket.off("user_offline");
        socket.off("incoming_call");
        socket.off("call_signal");

        // -----------------------------------------------------
        // CONNECT
        // -----------------------------------------------------

        socket.on("connect", () => {
            console.log(
                "[AETHERIS] Socket connected:",
                socket.id
            );

            window.dispatchEvent(
                new CustomEvent(
                    "aetheris:socket-connected"
                )
            );
        });

        // -----------------------------------------------------
        // DISCONNECT
        // -----------------------------------------------------

        socket.on("disconnect", (reason) => {
            console.warn(
                "[AETHERIS] Socket disconnected:",
                reason
            );

            window.dispatchEvent(
                new CustomEvent(
                    "aetheris:socket-disconnected",
                    {
                        detail: { reason }
                    }
                )
            );
        });

        // -----------------------------------------------------
        // CONNECTION ERROR
        // -----------------------------------------------------

        socket.on(
            "connect_error",
            (error) => {
                console.warn(
                    "[AETHERIS] Socket connection error:",
                    error?.message || error
                );
            }
        );

        // -----------------------------------------------------
        // MESSAGE RECEIVED
        // -----------------------------------------------------

        socket.on(
            "message_received",
            (payload) => {
                const message =
                    payload?.data?.message ||
                    payload?.message ||
                    payload;

                if (!message || !message.conversation_id) return;

                window.appChat?.handleIncomingMessage?.(
                    message,
                    normalizeMessage
                );
            }
        );

        socket.on("conversation_created", (payload) => {
            const raw = payload?.data?.conversation || payload?.conversation;
            if (raw) {
                window.appChat?.handleConversationCreated?.(
                    normalizeConversation(raw)
                );
            }
        });

        socket.on("messages_read", (payload) => {
            const data = payload?.data || payload;
            window.appChat?.handleMessagesRead?.(data);
        });

        // -----------------------------------------------------
        // DELIVERED
        // -----------------------------------------------------

        socket.on(
            "message_delivered",
            (payload) => {
                const data =
                    payload?.data ||
                    payload;

                if (!data) return;

                window.appChat
                    ?.updateMessageStatus?.(
                        Number(
                            data.message_id
                        ),
                        {
                            deliveredAt:
                                data.delivered_at ||
                                new Date().toISOString()
                        }
                    );
            }
        );

        // -----------------------------------------------------
        // READ / SEEN
        // -----------------------------------------------------

        socket.on(
            "message_read",
            (payload) => {
                const data =
                    payload?.data ||
                    payload;

                if (!data) return;

                window.appChat
                    ?.updateMessageStatus?.(
                        Number(
                            data.message_id
                        ),
                        {
                            readByRecipient:
                                true
                        }
                    );
            }
        );

        // -----------------------------------------------------
        // TYPING START
        // -----------------------------------------------------

        socket.on(
            "typing_start",
            (payload) => {
                window.appChat
                    ?.showTyping?.(
                        payload
                    );
            }
        );

        // -----------------------------------------------------
        // TYPING STOP
        // -----------------------------------------------------

        socket.on(
            "typing_stop",
            (payload) => {
                window.appChat
                    ?.hideTyping?.(
                        payload
                    );
            }
        );

        // -----------------------------------------------------
        // ONLINE
        // -----------------------------------------------------

        socket.on(
            "user_online",
            (payload) => {
                window.appChat
                    ?.updateUserPresence?.(
                        payload,
                        true
                    );
            }
        );

        // -----------------------------------------------------
        // OFFLINE
        // -----------------------------------------------------

        socket.on(
            "user_offline",
            (payload) => {
                window.appChat
                    ?.updateUserPresence?.(
                        payload,
                        false
                    );
            }
        );

        socket.on("incoming_call", (payload) => {
            window.aetherisCall?.handleIncoming(payload);
        });

        socket.on("call_signal", (payload) => {
            window.aetherisCall?.handleSignal(payload);
        });
    }

    // =========================================================
    // REAL-TIME SEND
    // =========================================================

    function sendMessageRealtime(
        conversationId,
        message
    ) {
        return new Promise(
            (resolve, reject) => {
                const socket =
                    getSocket();

                if (!socket) {
                    reject(
                        new Error(
                            "Socket.IO is unavailable."
                        )
                    );

                    return;
                }

                let completed = false;
                let responseTimeout;

                const cleanup = () => {
                    clearTimeout(responseTimeout);
                    clearTimeout(connectionTimeout);
                    socket.off("connect", send);
                    socket.off("connect_error", connectionFailed);
                };

                const finishWithError = (error) => {
                    if (completed) return;
                    completed = true;
                    cleanup();
                    reject(error);
                };

                const payload = {
                    conversation_id:
                        Number(
                            conversationId
                        ),

                    message_type:
                        message.message_type ||
                        message.type ||
                        "text",

                    message_text:
                        message.message_text ??
                        message.text ??
                        (message.caption || null),

                    media_id:
                        message.media_id ??
                        message.mediaId ??
                        null,

                    reel_id:
                        message.reel_id ??
                        message.reelId ??
                        null,

                    reply_to_message_id:
                        message.reply_to_message_id ??
                        null,

                    view_once:
                        Boolean(
                            message.view_once ??
                            message.viewOnce ??
                            false
                        )
                };

                const connectionFailed = (error) => {
                    finishWithError(
                        new Error(
                            error?.message ||
                            "Socket connection failed."
                        )
                    );
                };

                const send = () => {
                    if (completed || !socket.connected) return;
                    clearTimeout(connectionTimeout);
                    socket.off("connect", send);
                    socket.off("connect_error", connectionFailed);
                    responseTimeout = setTimeout(
                        () => finishWithError(new Error("Socket message timeout.")),
                        5000
                    );
                    socket.emit("send_message", payload, (response) => {
                        if (completed) return;
                        if (response?.success === false) {
                            finishWithError(
                                new Error(
                                    response.error?.message ||
                                    response.error ||
                                    "Message send failed."
                                )
                            );
                            return;
                        }
                        completed = true;
                        cleanup();
                        const messageData = response?.data?.message || response?.message || response?.data || response;
                        resolve(messageData ? normalizeMessage(messageData) : response);
                    });
                };

                const connectionTimeout = setTimeout(
                    () => finishWithError(new Error("Socket connection timeout.")),
                    3000
                );

                if (socket.connected) {
                    clearTimeout(connectionTimeout);
                    send();
                } else {
                    socket.once("connect", send);
                    socket.once("connect_error", connectionFailed);
                    if (!socket.active) connectSocket(getToken());
                }
            }
        );
    }

    // =========================================================
    // AUTH
    // =========================================================

    async function authenticate(payload) {
        const result =
            await callApi(
                "/auth/login",
                {
                    method: "POST",

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        if (!result?.access_token) {
            throw new Error(
                "Login successful but access token was not returned."
            );
        }

        saveToken(
            result.access_token
        );

        if (window.aetherisState) {
            window.aetherisState.currentUser =
                normalizeUser(
                    result.user
                );
        }

        connectSocket(
            result.access_token
        );

        return {
            ...result,

            user:
                normalizeUser(
                    result.user
                )
        };
    }

    // =========================================================
    // MEDIA
    // =========================================================

    async function fetchMediaBlob(
        mediaId
    ) {
        const response =
            await authorizedFetch(
                `/media/${encodeURIComponent(
                    mediaId
                )}`
            );

        if (!response.ok) {
            const payload =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );

            throw new Error(
                payload?.error?.message ||
                `Media request failed (${response.status})`
            );
        }

        return response.blob();
    }

    async function viewOnceMedia(
        mediaId
    ) {
        const numericMediaId = Number(mediaId);
        if (!Number.isInteger(numericMediaId) || numericMediaId <= 0) {
            throw new Error(
                "This photo has no valid media reference. Reload the conversation."
            );
        }

        const response =
            await authorizedFetch(
                `/media/${encodeURIComponent(
                    numericMediaId
                )}/view-once`,
                {
                    method: "POST"
                }
            );

        if (!response.ok) {
            const payload =
                await response
                    .json()
                    .catch(
                        () => ({})
                    );

            throw new Error(
                payload?.error?.message ||
                `View-once request failed (${response.status})`
            );
        }

        return response.blob();
    }

    async function resolveAvatar(userId, avatarReference) {
        if (!avatarReference) return "";
        if (!String(avatarReference).startsWith("/api/media/")) return avatarReference;
        const mediaId = String(avatarReference).split("/").pop();
        const key = `${userId || "self"}:${mediaId}`;
        if (avatarObjectUrls.has(key)) return avatarObjectUrls.get(key);
        const path = userId
            ? `/users/${encodeURIComponent(userId)}/avatar`
            : `/media/${encodeURIComponent(mediaId)}`;
        const response = await authorizedFetch(path);
        if (!response.ok) throw new Error("Avatar is unavailable.");
        const objectUrl = URL.createObjectURL(await response.blob());
        avatarObjectUrls.set(key, objectUrl);
        return objectUrl;
    }

    // =========================================================
    // PUBLIC API
    // =========================================================

    function uploadWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_ROOT}/media/upload`);
            const token = getToken();
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
            };
            xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
            xhr.onload = () => {
                let payload = {};
                try { payload = JSON.parse(xhr.responseText); } catch (e) { /* non-JSON error */ }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(payload?.data ?? payload);
                } else {
                    if (xhr.status === 401) {
                        clearToken();
                        window.dispatchEvent(new CustomEvent("aetheris:auth-invalid"));
                    }
                    reject(new Error(payload?.error?.message || `Upload failed (${xhr.status})`));
                }
            };
            const form = new FormData();
            form.append("file", file);
            xhr.send(form);
        });
    }

    window.aetherisApi = {
        hasToken,
        connectSocket,

        async fetchNotificationsSummary() {
            const result = await callApi("/notifications");
            return {
                notifications: result.notifications || [],
                unread: Number(result.unread_count || 0)
            };
        },

        markAllNotificationsRead() {
            return callApi("/notifications/read-all", { method: "POST" });
        },

        async markConversationRead(conversationId) {
            const socket = getSocket();
            if (socket?.connected) {
                return new Promise((resolve) => {
                    const timer = setTimeout(() => resolve(null), 4000);
                    socket.emit("conversation_read", { conversation_id: Number(conversationId) }, (response) => {
                        clearTimeout(timer);
                        resolve(response);
                    });
                });
            }
            return callApi(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
        },

        isBlocked(userId) {
            return callApi(`/users/${encodeURIComponent(userId)}/blocked`).then((r) => Boolean(r.blocked));
        },

        blockUser(userId, block) {
            return callApi(`/users/${encodeURIComponent(userId)}/block`, { method: block ? "PUT" : "DELETE" });
        },

        createReel(reel) {
            return callApi("/reels", { method: "POST", body: JSON.stringify(reel) });
        },

        getToken,
        clearToken,

        async fetchCallIceServers() {
            const result = await callApi('/calls/ice-servers');
            return result.ice_servers || [];
        },

        async fetchNotifications() {
            const result = await callApi('/notifications');
            return result.notifications || [];
        },

        async markNotificationRead(notificationId) {
            return callApi(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' });
        },

        resolveAvatar,

        login(credentials) {
            const identifier =
                credentials.email ||
                credentials.username ||
                credentials.identifier;

            return authenticate({
                email: identifier,
                password:
                    credentials.password
            });
        },

        async signup(details) {
            const username =
                String(
                    details.username ||
                    details.handle ||
                    ""
                ).replace(
                    /^@/,
                    ""
                );

            await callApi(
                "/auth/register",
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            full_name:
                                details.full_name ||
                                details.name,

                            username,

                            email:
                                details.email,

                            password:
                                details.password
                        })
                }
            );

            return authenticate({
                email:
                    details.email,

                password:
                    details.password
            });
        },

        async logout() {
            try {
                if (hasToken()) {
                    await callApi(
                        "/auth/logout",
                        {
                            method: "POST"
                        }
                    );
                }
            } catch (error) {
                console.warn(
                    "[AETHERIS] Logout API error:",
                    error
                );
            } finally {
                clearToken();

                const socket =
                    getSocket();

                if (socket) {
                    socket.disconnect();
                }

                if (
                    window.aetherisState
                ) {
                    window.aetherisState.currentUser =
                        null;
                }
            }
        },

        async fetchCurrentUser() {
            const result =
                await callApi(
                    "/auth/me"
                );

            return {
                ...result,

                user:
                    normalizeUser(
                        result.user
                    )
            };
        },

        async fetchConversations() {
            const result =
                await callApi(
                    "/conversations"
                );

            const conversations =
                (
                    result.conversations ||
                    []
                ).map(
                    normalizeConversation
                );

            return {
                ...result,
                conversations
            };
        },

        async fetchMessages(conversationId, options = {}) {
            const query = new URLSearchParams({ limit: String(options.limit || 50) });
            if (options.beforeId) query.set("before_id", String(options.beforeId));
            const result = await callApi(
                `/conversations/${encodeURIComponent(conversationId)}/messages?${query}`
            );
            return {
                ...result,
                messages: (result.messages || []).map(normalizeMessage)
            };
        },

        /*
         * IMPORTANT:
         * Send through Socket.IO first.
         *
         * If Socket.IO is disconnected
         * or times out, use HTTP API fallback.
         */

        async sendMessage(
            conversationId,
            message
        ) {
            try {
                return await sendMessageRealtime(
                    conversationId,
                    message
                );
            } catch (socketError) {
                console.warn(
                    "[AETHERIS] Socket send failed. Using HTTP fallback:",
                    socketError.message
                );

                const body = {
                    message_type:
                        message.message_type ||
                        message.type ||
                        "text",

                    message_text:
                        message.message_text ||
                        message.text ||
                        message.caption ||
                        null,

                    media_id:
                        message.media_id ??
                        message.mediaId ??
                        null,

                    reel_id:
                        message.reel_id ??
                        message.reelId ??
                        null,

                    reply_to_message_id:
                        message.reply_to_message_id ??
                        null,

                    view_once:
                        Boolean(
                            message.view_once ??
                            message.viewOnce ??
                            false
                        )
                };

                const result =
                    await callApi(
                        `/conversations/${encodeURIComponent(
                            conversationId
                        )}/messages`,
                        {
                            method: "POST",

                            body:
                                JSON.stringify(
                                    body
                                )
                        }
                    );

                return {
                    ...result,

                    message:
                        result.message
                            ? normalizeMessage(
                                  result.message
                              )
                            : undefined
                };
            }
        },

        uploadMedia(file, onProgress) {
            return uploadWithProgress(file, onProgress);
        },

        fetchMediaBlob,

        viewOnceMedia,

        async fetchReels() {
            const result =
                await callApi(
                    "/reels"
                );

            return {
                ...result,

                reels:
                    result.reels ||
                    []
            };
        },

        async updateProfile(
            profile
        ) {
            const body = {
                full_name:
                    profile.full_name ||
                    profile.name,

                username:
                    profile.username ||
                    profile.handle?.replace(
                        /^@/,
                        ""
                    ),

                bio:
                    profile.bio,

                avatar:
                    profile.avatar
            };

            Object.keys(body).forEach(
                (key) => {
                    if (
                        body[key] ===
                        undefined
                    ) {
                        delete body[key];
                    }
                }
            );

            const result =
                await callApi(
                    "/profile",
                    {
                        method: "PATCH",

                        body:
                            JSON.stringify(
                                body
                            )
                    }
                );

            return {
                ...result,

                user:
                    normalizeUser(
                        result.user
                    )
            };
        },

        async createConversation(
            username
        ) {
            const cleanUsername =
                String(
                    username || ""
                )
                    .replace(
                        /^@/,
                        ""
                    )
                    .trim();

            const result =
                await callApi(
                    "/conversations",
                    {
                        method: "POST",

                        body:
                            JSON.stringify({
                                target_username:
                                    cleanUsername
                            })
                    }
                );

            const conversation =
                result.conversation
                    ? normalizeConversation(
                          result.conversation
                      )
                    : null;

            if (
                conversation &&
                getSocket()?.connected
            ) {
                getSocket().emit(
                    "join_conversation",
                    {
                        conversation_id:
                            Number(
                                conversation.id
                            )
                    }
                );
            }

            return {
                ...result,
                conversation
            };
        }
    };

})();