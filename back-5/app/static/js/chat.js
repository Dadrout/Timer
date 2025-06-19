let ws = null;
let wsConnected = false; // Prevent multiple connections
let currentUser = null;
let selectedUser = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// Audio recording state
let mediaRecorder = null;
let audioChunks = [];

// --- WebRTC Video Call Logic with Accept/Reject ---
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let pendingOffer = null;
let callFromUser = null;
let callStatus = null;
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const videoCallBtn = document.getElementById('video-call');
const hangupBtn = document.getElementById('hangup-call');
const videoCallContainer = document.getElementById('video-call-container');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Call modal elements
let callModal = document.getElementById('callModal');
let callModalAccept = null;
let callModalReject = null;
let callModalText = null;

let iceCandidateBuffer = [];
let remoteDescriptionSet = false;

function ensureCallModal() {
    console.log('[DEBUG] ensureCallModal called');
    if (!callModal) {
        callModal = document.createElement('div');
        callModal.id = 'callModal';
        callModal.className = 'modal fade';
        callModal.tabIndex = -1;
        callModal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-dark text-white">
                <div class="modal-header">
                    <h5 class="modal-title">Incoming Video Call</h5>
                </div>
                <div class="modal-body">
                    <p id="callModalText">User is calling you...</p>
                </div>
                <div class="modal-footer">
                    <button type="button" id="callModalAccept" class="btn btn-success">Accept</button>
                    <button type="button" id="callModalReject" class="btn btn-danger">Reject</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(callModal);
    }
    callModalAccept = document.getElementById('callModalAccept');
    callModalReject = document.getElementById('callModalReject');
    callModalText = document.getElementById('callModalText');
}

// Initialize WebSocket connection
async function initWebSocket() {
    if (wsConnected) {
        console.log('WebSocket already connected, skipping init.');
        return;
    }
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Not logged in');
        }

        const user = await getCurrentUser();
        if (!user) {
            throw new Error('Failed to get user info');
        }

        currentUser = user;
        console.log('Current user set:', currentUser);
        connectWebSocket(user.id, token);
    } catch (error) {
        console.error('WebSocket initialization error:', error);
        showError('Failed to initialize chat. Please try logging in again.');
    }
}

// Connect to WebSocket
function connectWebSocket(userId, token) {
    if (ws) {
        ws.close();
    }

    ws = new WebSocket(`ws://${window.location.host}/ws/${userId}?token=${token}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
        wsConnected = true;
        reconnectAttempts = 0;
        updateConnectionStatus(true);
        loadUsers(); // Always load users after WebSocket is connected
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        wsConnected = false;
        updateConnectionStatus(false);
        // Attempt to reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => {
                console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                connectWebSocket(currentUser.id, getToken());
            }, RECONNECT_DELAY);
        } else {
            showError('Connection lost. Please refresh the page.');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showError('Connection error. Please try again.');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    console.log('Received WebSocket message:', data);
    
    if (data.type === 'webrtc-signal') {
        handleWebRTCSignal(data);
        return;
    }
    
    switch (data.type) {
        case 'message':
            handleNewMessage(data);
            break;
        case 'status':
            handleUserStatus(data);
            break;
        case 'error':
            showError(data.message || 'An error occurred');
            break;
        default:
            console.warn('Unknown message type:', data.type);
    }
}

// Handle new message
function handleNewMessage(data) {
    console.log('[DEBUG] handleNewMessage called with:', data);
    const message = {
        id: data.id,
        sender_id: data.from_user,
        receiver_id: data.to_user,
        content: data.content,
        message_type: data.message_type,
        created_at: new Date(data.timestamp).toISOString()
    };

    // Only add message to UI if it's from/to the selected user
    if (selectedUser && (message.sender_id === selectedUser.id || message.receiver_id === selectedUser.id)) {
        addMessageToUI(message);
    }
}

// Handle user status update
function handleUserStatus(data) {
    const userStatus = document.querySelector(`#user-${data.user_id} .user-status`);
    if (userStatus) {
        userStatus.textContent = data.status;
        userStatus.className = `user-status ${data.status}`;
    }
}

// Send message
function sendMessage(content, messageType = 'TEXT') {
    if (!ws || !selectedUser) {
        showError('Cannot send message. Please select a user to chat with.');
        return;
    }

    const message = {
        target_id: selectedUser.id,
        content: content,
        message_type: messageType
    };

    try {
        console.log('Sending message:', message);
        ws.send(JSON.stringify(message));
    } catch (error) {
        console.error('Error sending message:', error);
        showError('Failed to send message. Please try again.');
    }
}

// Load chat history
async function loadChatHistory(userId) {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Not logged in');
        }

        console.log('Loading chat history for user:', userId);

        const response = await fetch(`/messages/?receiver_id=${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to load chat history');
        }

        const messages = await response.json();
        console.log('Loaded messages:', messages);
        displayChatHistory(messages);
    } catch (error) {
        console.error('Load chat history error:', error);
        showError('Failed to load chat history');
    }
}

// Display chat history
function displayChatHistory(messages) {
    const chatMessages = document.getElementById('messages');
    console.log('Messages container found:', chatMessages);
    
    if (!chatMessages) {
        console.error('Messages container not found');
        return;
    }
    
    chatMessages.innerHTML = '';  // Clear existing messages

    if (messages && messages.length > 0) {
        messages.forEach(message => {
            addMessageToUI(message);
        });
    } else {
        // Show a message when there's no chat history
        const noMessagesElement = document.createElement('div');
        noMessagesElement.className = 'text-center text-muted mt-4';
        noMessagesElement.innerHTML = '<p>No messages yet. Start the conversation!</p>';
        chatMessages.appendChild(noMessagesElement);
    }

    // Only scroll if the container is visible
    setTimeout(() => scrollToBottom(), 100);
}

// Add message to UI
function addMessageToUI(message) {
    console.log('[DEBUG] addMessageToUI:', message);
    const chatMessages = document.getElementById('messages');
    if (!chatMessages) {
        console.error('Messages container not found');
        return;
    }
    // Remove the "no messages" placeholder if it exists
    const noMessagesElement = chatMessages.querySelector('.text-muted');
    if (noMessagesElement) {
        noMessagesElement.remove();
    }
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender_id === currentUser?.id ? 'sent' : 'received'}`;
    let content = '';
    const type = (message.message_type || '').toUpperCase();
    if (type === 'IMAGE') {
        console.log('[DEBUG] Rendering IMAGE:', message.content);
        const filename = message.content;
        content = `<img src="/media/${filename}" alt="Image" style="max-width: 200px; max-height: 200px; border-radius: 8px;">`;
    } else if (type === 'VOICE') {
        console.log('[DEBUG] Rendering VOICE:', message.content);
        const filename = message.content;
        content = `<audio controls src="/media/${filename}" style="max-width: 200px; border-radius: 8px;"></audio>`;
    } else if (type === 'TEXT') {
        content = message.content;
    } else {
        content = `<${type.toLowerCase()}-message>${message.content}</${type.toLowerCase()}-message>`;
    }
    messageElement.innerHTML = `
        <div class="message-content">
            ${content}
        </div>
        <div class="message-time">${new Date(message.created_at).toLocaleTimeString()}</div>
    `;
    chatMessages.appendChild(messageElement);
    setTimeout(() => scrollToBottom(), 100);
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.textContent = connected ? 'Connected' : 'Disconnected';
        statusElement.className = connected ? 'connected' : 'disconnected';
    }
}

// Show error message
function showError(message) {
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
}

// Scroll chat to bottom
function scrollToBottom() {
    const chatMessages = document.getElementById('messages');
    if (chatMessages && chatMessages.scrollHeight && chatMessages.offsetHeight > 0) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Load users list
async function loadUsers() {
    try {
        const token = getToken();
        if (!token) {
            throw new Error('Not logged in');
        }

        const response = await fetch('/users/', {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to load users');
        }

        const users = await response.json();
        console.log('Loaded users:', users);
        console.log('Current user:', currentUser);
        displayUsers(users);
    } catch (error) {
        console.error('Load users error:', error);
        showError('Failed to load users');
    }
}

// Display users in the list
function displayUsers(users) {
    window.lastUserList = users;
    const userList = document.getElementById('user-list');
    if (!userList) {
        console.error('User list container not found');
        return;
    }
    
    userList.innerHTML = '';

    console.log('Displaying users. Current user ID:', currentUser?.id);
    console.log('All users:', users);

    users.forEach(user => {
        console.log('Checking user:', user.username, 'ID:', user.id, 'Current user ID:', currentUser?.id);
        // Make sure we're comparing the same types
        if (user.id !== currentUser?.id) {  // Don't show current user in the list
            const userElement = document.createElement('div');
            userElement.className = 'user-item p-3 border-bottom';
            userElement.id = `user-${user.id}`;
            userElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-0">${user.username}</h6>
                        <small class="text-muted user-status">offline</small>
                    </div>
                </div>
            `;
            userElement.addEventListener('click', () => selectUser(user));
            userList.appendChild(userElement);
        } else {
            console.log('Skipping current user:', user.username);
        }
    });
}

// Select user to chat with
function selectUser(user) {
    console.log('[DEBUG] selectUser called with:', user);
    console.log('[DEBUG] Current user list:', window.lastUserList || []);
    console.log('Selecting user:', user);
    
    // Clear previous chat
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    } else {
        console.error('Messages container not found when selecting user');
    }
    
    // Update selected user
    selectedUser = user;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    const userElement = document.getElementById(`user-${user.id}`);
    if (userElement) {
        userElement.classList.add('active');
    }
    
    // Load chat history
    loadChatHistory(user.id);
}

// Get current user info
async function getCurrentUser() {
    try {
        const token = getToken();
        if (!token) {
            return null;
        }

        const response = await fetch('/users/me', {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('Get current user error:', error);
        return null;
    }
}

// Clean up chat state
function cleanupChat() {
    currentUser = null;
    selectedUser = null;
    if (ws) {
        ws.close();
        ws = null;
    }
    document.getElementById('user-list').innerHTML = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('message-input').value = '';
}

// Send image
async function sendImage(file) {
    if (!selectedUser) {
        showError('Please select a user to chat with.');
        return;
    }
    console.log('[DEBUG] sendImage selectedUser:', selectedUser, 'selectedUser.id:', selectedUser.id);
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('receiver_id', parseInt(selectedUser.id));
        const token = getToken();
        const response = await fetch('/messages/media/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData
        });
        if (!response.ok) {
            let errorMsg = 'Failed to send image';
            try { errorMsg = (await response.json()).detail || errorMsg; } catch {}
            throw new Error(errorMsg);
        }
        const message = await response.json();
        console.log('Image sent successfully:', message);
        const imageMessage = {
            id: message.id,
            sender_id: currentUser?.id,
            receiver_id: selectedUser.id,
            content: message.content,
            message_type: 'IMAGE',
            created_at: message.created_at
        };
        addMessageToUI(imageMessage);
    } catch (error) {
        console.error('Error sending image:', error);
        showError(error.message || 'Failed to send image. Please try again.');
    }
}

// Handle audio recording
const recordAudioBtn = document.getElementById('record-audio');
if (recordAudioBtn) {
    recordAudioBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            recordAudioBtn.classList.remove('btn-danger');
            recordAudioBtn.classList.add('btn-outline-primary');
            recordAudioBtn.innerHTML = '🎤 Audio';
            return;
        }
        // Request microphone access
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                sendAudio(audioBlob);
            };
            mediaRecorder.start();
            recordAudioBtn.classList.remove('btn-outline-primary');
            recordAudioBtn.classList.add('btn-danger');
            recordAudioBtn.innerHTML = '⏹️ Stop';
        } catch (err) {
            showError('Microphone access denied or not available.');
        }
    });
    // Always reset to 🎤 Audio on page load
    recordAudioBtn.innerHTML = '🎤 Audio';
}

// Send audio message
async function sendAudio(audioBlob) {
    if (!selectedUser) {
        showError('Please select a user to chat with.');
        return;
    }
    console.log('[DEBUG] sendAudio selectedUser:', selectedUser, 'selectedUser.id:', selectedUser.id);
    try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio_message.webm');
        formData.append('receiver_id', parseInt(selectedUser.id));
        const token = getToken();
        const response = await fetch('/messages/media/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData
        });
        if (!response.ok) {
            let errorMsg = 'Failed to send audio';
            try { errorMsg = (await response.json()).detail || errorMsg; } catch {}
            throw new Error(errorMsg);
        }
        const message = await response.json();
        const audioMessage = {
            id: message.id,
            sender_id: currentUser?.id,
            receiver_id: selectedUser.id,
            content: message.content,
            message_type: 'VOICE',
            created_at: message.created_at
        };
        addMessageToUI(audioMessage);
    } catch (error) {
        console.error('Error sending audio:', error);
        showError(error.message || 'Failed to send audio. Please try again.');
    }
}

// Initialize chat when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, checking sections...');
    
    // Check initial state
    const chatSection = document.getElementById('chat-section');
    const authSection = document.getElementById('auth-section');
    
    console.log('Chat section:', chatSection);
    console.log('Auth section:', authSection);
    console.log('Chat section classes:', chatSection?.className);
    console.log('Auth section classes:', authSection?.className);
    
    // Only initialize WebSocket if we have a token
    if (getToken()) {
        console.log('Token found, initializing chat...');
        initWebSocket();
    } else {
        // Don't redirect - just stay on the login page
        console.log('No token found, staying on login page');
        
        // Ensure auth section is visible and chat section is hidden
        if (authSection) {
            authSection.classList.remove('d-none');
        }
        if (chatSection) {
            chatSection.classList.add('d-none');
        }
    }

    // Handle message form submission
    document.getElementById('message-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (content) {
            if (!selectedUser) {
                showError('Please select a user to chat with');
                return;
            }
            sendMessage(content);
            input.value = '';
        }
    });

    // Handle image upload
    const imageUpload = document.getElementById('image-upload');
    const uploadImageBtn = document.getElementById('upload-image');
    
    if (uploadImageBtn && imageUpload) {
        uploadImageBtn.addEventListener('click', () => {
            imageUpload.click();
        });
        
        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 5 * 1024 * 1024) { // 5MB limit
                    showError('Image size must be less than 5MB');
                    return;
                }
                sendImage(file);
                imageUpload.value = ''; // Clear the input
            }
        });
    }

    if (videoCallBtn) {
        videoCallBtn.addEventListener('click', startVideoCall);
    }
    if (hangupBtn) {
        hangupBtn.addEventListener('click', hangupCall);
    }
});

async function startVideoCall() {
    if (!selectedUser) {
        showError('Please select a user to call.');
        return;
    }
    callStatus = 'calling';
    updateCallStatus('Calling...');
    videoCallContainer.classList.remove('d-none');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    peerConnection = createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendWebRTCSignal({ sdp: offer });
}

function hangupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteVideo) remoteVideo.srcObject = null;
    if (localVideo) localVideo.srcObject = null;
    videoCallContainer.classList.add('d-none');
    updateCallStatus('');
    pendingOffer = null;
    callFromUser = null;
    callStatus = null;
}

function createPeerConnection() {
    const pc = new RTCPeerConnection(iceServers);
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWebRTCSignal({ candidate: event.candidate });
        }
    };
    pc.ontrack = (event) => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
    };
    return pc;
}

function sendWebRTCSignal(signal) {
    if (!ws || !selectedUser) return;
    ws.send(JSON.stringify({
        type: 'webrtc-signal',
        target_id: selectedUser.id,
        signal
    }));
}

function sendWebRTCSignalTo(userId, signal) {
    if (!ws) return;
    ws.send(JSON.stringify({
        type: 'webrtc-signal',
        target_id: userId,
        signal
    }));
}

function updateCallStatus(text) {
    let statusDiv = document.getElementById('call-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'call-status';
        statusDiv.style = 'color: #00fff7; font-weight: bold; margin-bottom: 8px; text-align: center;';
        videoCallContainer.insertBefore(statusDiv, videoCallContainer.firstChild);
    }
    statusDiv.textContent = text;
}

// Handle incoming WebRTC signaling
function handleWebRTCSignal(data) {
    console.log('[DEBUG] handleWebRTCSignal', data);
    if (!data.signal) return;
    // If receiving an offer, show accept/reject modal
    if (data.signal.sdp && data.signal.sdp.type === 'offer') {
        ensureCallModal();
        pendingOffer = data.signal.sdp;
        callFromUser = data.from_user;
        callModalText.textContent = `User ${data.from_user} is calling you...`;
        // Show modal (Bootstrap way)
        if (window.bootstrap && window.bootstrap.Modal) {
            const modal = new window.bootstrap.Modal(callModal);
            modal.show();
        } else {
            callModal.style.display = 'block';
        }
        callModalAccept.onclick = async () => {
            if (window.bootstrap && window.bootstrap.Modal) {
                const modal = window.bootstrap.Modal.getInstance(callModal);
                modal.hide();
            } else {
                callModal.style.display = 'none';
            }
            acceptCall();
        };
        callModalReject.onclick = () => {
            if (window.bootstrap && window.bootstrap.Modal) {
                const modal = window.bootstrap.Modal.getInstance(callModal);
                modal.hide();
            } else {
                callModal.style.display = 'none';
            }
            sendWebRTCSignalTo(callFromUser, { rejected: true });
            updateCallStatus('Call rejected');
            pendingOffer = null;
            callFromUser = null;
        };
        return;
    }
    // If call was rejected
    if (data.signal.rejected) {
        updateCallStatus('Call rejected by user');
        hangupCall();
        return;
    }
    // If answer
    if (data.signal.sdp && data.signal.sdp.type === 'answer') {
        if (peerConnection) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp)).then(() => {
                remoteDescriptionSet = true;
                iceCandidateBuffer.forEach(candidate => {
                    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                });
                iceCandidateBuffer = [];
            });
            updateCallStatus('In call');
        } else {
            console.warn('Received answer but peerConnection is null');
        }
        return;
    }
    // ICE candidates
    if (data.signal.candidate) {
        if (!peerConnection) {
            // Create peerConnection if not exists (for robustness)
            peerConnection = createPeerConnection();
        }
        if (!remoteDescriptionSet) {
            iceCandidateBuffer.push(data.signal.candidate);
        } else {
            peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
        return;
    }
}

async function acceptCall() {
    callStatus = 'in-call';
    videoCallContainer.classList.remove('d-none');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
        showError('Could not access camera/microphone. Please check permissions.');
        sendWebRTCSignalTo(callFromUser, { rejected: true });
        return;
    }
    localVideo.srcObject = localStream;
    peerConnection = createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    remoteDescriptionSet = true;
    iceCandidateBuffer.forEach(candidate => {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    });
    iceCandidateBuffer = [];
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendWebRTCSignalTo(callFromUser, { sdp: answer });
    updateCallStatus('In call');
    pendingOffer = null;
    callFromUser = null;
} 