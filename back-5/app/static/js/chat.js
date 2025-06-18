class Chat {
    constructor() {
        this.ws = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.selectedUser = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('message-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        document.getElementById('record-audio').addEventListener('click', () => {
            this.startRecording('audio');
        });

        document.getElementById('record-video').addEventListener('click', () => {
            this.startRecording('video');
        });

        document.getElementById('stop-recording').addEventListener('click', () => {
            this.stopRecording();
        });

        document.getElementById('send-media').addEventListener('click', () => {
            this.sendMediaMessage();
        });
    }

    initialize() {
        this.connectWebSocket();
        // Wait for WebSocket connection before loading users
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.loadUsers();
            this.loadMessages();
        };
    }

    connectWebSocket() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            alert('Unable to establish connection. Please refresh the page.');
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = window.auth.getToken();
        const wsUrl = `${protocol}//${window.location.host}/ws/${window.auth.currentUser.id}?token=${token}`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        
        if (this.ws) {
            console.log('Closing existing WebSocket connection');
            this.ws.close();
        }
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected successfully');
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
            this.loadUsers();
            this.loadMessages();
        };
        
        this.ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
            try {
                const message = JSON.parse(event.data);
                this.handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.ws.onclose = (event) => {
            console.log('WebSocket disconnected:', {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });

            // Only attempt to reconnect if the connection was closed unexpectedly
            if (event.code !== 1000) {
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    setTimeout(() => this.connectWebSocket(), 1000 * this.reconnectAttempts); // Exponential backoff
                } else {
                    alert('Connection lost. Please refresh the page.');
                }
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    async loadUsers() {
        try {
            console.log('Loading users...');
            const response = await fetch('/users/', {
                headers: window.auth.getAuthHeader()
            });
            
            if (response.ok) {
                const users = await response.json();
                console.log('Loaded users:', users);
                const userList = document.getElementById('user-list');
                userList.innerHTML = '';
                
                users.forEach(user => {
                    if (user.id !== window.auth.currentUser.id) {
                        const userItem = document.createElement('div');
                        userItem.className = 'user-item';
                        userItem.textContent = user.username;
                        userItem.dataset.userId = user.id;
                        userItem.onclick = () => this.selectUser(user);
                        userList.appendChild(userItem);
                    }
                });
            } else {
                console.error('Failed to load users:', await response.text());
                alert('Failed to load users. Please refresh the page.');
            }
        } catch (error) {
            console.error('Error loading users:', error);
            alert('Error loading users. Please refresh the page.');
        }
    }

    async loadMessages() {
        if (!this.selectedUser) return;

        try {
            const response = await fetch(`/messages/?receiver_id=${this.selectedUser.id}`, {
                headers: window.auth.getAuthHeader()
            });
            
            if (response.ok) {
                const messages = await response.json();
                const messagesContainer = document.getElementById('messages');
                messagesContainer.innerHTML = '';
                
                messages.forEach(message => {
                    this.displayMessage(message);
                });
                
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    selectUser(user) {
        this.selectedUser = user;
        document.querySelectorAll('.user-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.userId === user.id.toString()) {
                item.classList.add('active');
            }
        });
        this.loadMessages();
    }

    async sendMessage() {
        if (!this.selectedUser) {
            alert('Please select a user to chat with');
            return;
        }

        const messageInput = document.getElementById('message-input');
        const content = messageInput.value.trim();
        
        if (!content) return;

        console.log('Attempting to send message:', {
            content,
            toUser: this.selectedUser,
            wsState: this.ws ? this.ws.readyState : 'no connection'
        });

        try {
            // Send message through WebSocket
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'message',
                    content: content,
                    to_user: this.selectedUser.id
                };
                console.log('Sending WebSocket message:', message);
                this.ws.send(JSON.stringify(message));
                messageInput.value = '';
                
                // Also display the message locally
                this.displayMessage({
                    sender_id: window.auth.currentUser.id,
                    content: content
                });
            } else {
                console.error('WebSocket state:', this.ws ? this.ws.readyState : 'no connection');
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.connectWebSocket(); // Try to reconnect
                    alert('Connection lost. Trying to reconnect...');
                } else {
                    alert('Connection lost. Please refresh the page.');
                }
            }
        } catch (error) {
            console.error('Error sending message:', error);
            alert('Error sending message. Please try again.');
        }
    }

    async startRecording(type) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                [type]: true
            });

            this.mediaRecorder = new MediaRecorder(stream);
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };

            this.mediaRecorder.start();
            document.getElementById('recording-indicator').classList.remove('d-none');
            document.getElementById('stop-recording').classList.remove('d-none');
            document.getElementById('record-audio').classList.add('d-none');
            document.getElementById('record-video').classList.add('d-none');
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Error accessing media devices');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            
            document.getElementById('recording-indicator').classList.add('d-none');
            document.getElementById('stop-recording').classList.add('d-none');
            document.getElementById('record-audio').classList.remove('d-none');
            document.getElementById('record-video').classList.remove('d-none');
            document.getElementById('send-media').classList.remove('d-none');
        }
    }

    async sendMediaMessage() {
        if (!this.selectedUser || !this.recordedChunks.length) return;

        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const formData = new FormData();
        formData.append('file', blob, 'recording.webm');
        formData.append('receiver_id', this.selectedUser.id);
        formData.append('message_type', 'VIDEO');

        try {
            const response = await fetch('/messages/', {
                method: 'POST',
                headers: window.auth.getAuthHeader(),
                body: formData
            });

            if (response.ok) {
                const message = await response.json();
                this.displayMessage(message);
                this.recordedChunks = [];
                document.getElementById('send-media').classList.add('d-none');
            }
        } catch (error) {
            console.error('Error sending media message:', error);
        }
    }

    displayMessage(message) {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.sender_id === window.auth.currentUser.id ? 'sent' : 'received'}`;

        if (message.media_file) {
            const mediaElement = document.createElement(message.media_type.startsWith('video') ? 'video' : 'audio');
            mediaElement.controls = true;
            mediaElement.src = `/messages/${message.id}/media`;
            messageElement.appendChild(mediaElement);
        } else {
            messageElement.textContent = message.content;
        }

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    handleWebSocketMessage(message) {
        console.log('Handling WebSocket message:', message);
        if (message.type === 'message') {
            // If the message is from the currently selected user or sent by us
            if (message.from_user === this.selectedUser?.id || message.from_user === window.auth.currentUser.id) {
                this.displayMessage({
                    sender_id: parseInt(message.from_user),
                    content: message.content,
                    media_file: message.media_file,
                    media_type: message.media_type
                });
            }
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Initialize chat module
window.chat = new Chat(); 