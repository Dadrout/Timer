class Auth {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('token');
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });
    }

    getToken() {
        return this.token;
    }

    getAuthHeader() {
        return {
            'Authorization': `Bearer ${this.token}`
        };
    }

    async login() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch('/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
            });

            const data = await response.json();
            
            if (response.ok && data.access_token) {
                this.token = data.access_token;
                localStorage.setItem('token', this.token);
                
                // Get user info
                const userResponse = await fetch('/users/me', {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                });
                
                if (userResponse.ok) {
                    this.currentUser = await userResponse.json();
                    console.log('Auth: User logged in:', this.currentUser);
                    this.showChat();
                } else {
                    localStorage.removeItem('token');
                    this.token = null;
                    console.error('Failed to get user info:', await userResponse.text());
                    alert('Login failed. Please try again.');
                }
            } else {
                localStorage.removeItem('token');
                this.token = null;
                alert(data.detail || 'Login failed. Please check your credentials.');
            }
        } catch (error) {
            localStorage.removeItem('token');
            this.token = null;
            console.error('Login error:', error);
            alert('Login failed. Please try again.');
        }
    }

    async register() {
        const username = document.getElementById('register-username').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;

        try {
            const response = await fetch('/users/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    email,
                    password
                })
            });

            if (response.ok) {
                alert('Registration successful. Please login.');
                document.getElementById('register-username').value = '';
                document.getElementById('register-email').value = '';
                document.getElementById('register-password').value = '';
                
                // Switch to login tab
                document.getElementById('login-tab').click();
            } else {
                const error = await response.json();
                alert(`Registration failed: ${error.detail}`);
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Registration failed. Please try again.');
        }
    }

    showChat() {
        console.log('showChat called');
        const authSection = document.getElementById('auth-section');
        const chatSection = document.getElementById('chat-section');
        
        console.log('Before: Auth section classes:', authSection?.className);
        console.log('Before: Chat section classes:', chatSection?.className);
        
        authSection.classList.add('d-none');
        chatSection.classList.remove('d-none');
        
        console.log('After: Auth section classes:', authSection?.className);
        console.log('After: Chat section classes:', chatSection?.className);
        
        // Immediately load users
        if (window.chat && typeof window.chat.loadUsers === 'function') {
            window.chat.loadUsers();
        }
        // Wait a bit for the DOM to update before initializing chat
        setTimeout(() => {
            // Initialize WebSocket after successful login
            if (window.chat && typeof window.chat.initWebSocket === 'function') {
                window.chat.initWebSocket();
            }
        }, 100);
    }

    logout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('token');
        document.getElementById('chat-section').classList.add('d-none');
        document.getElementById('auth-section').classList.remove('d-none');
        // Clean up chat state
        if (window.chat && typeof window.chat.cleanupChat === 'function') {
            window.chat.cleanupChat();
        }
    }
}

// Initialize auth module
window.auth = new Auth();

// Helper functions
function setToken(token) {
    localStorage.setItem('token', token);
}

function getToken() {
    return localStorage.getItem('token');
}

function removeToken() {
    localStorage.removeItem('token');
}

function isLoggedIn() {
    return !!getToken();
}

document.addEventListener('DOMContentLoaded', async () => {
    const authSection = document.getElementById('auth-section');
    const chatSection = document.getElementById('chat-section');
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const response = await fetch('/users/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                window.auth.currentUser = await response.json();
                authSection.classList.add('d-none');
                chatSection.classList.remove('d-none');
                if (window.chat && typeof window.chat.initWebSocket === 'function') {
                    window.chat.initWebSocket();
                }
                return;
            }
        } catch (e) { /* ignore */ }
    }
    // If not logged in or token invalid
    authSection.classList.remove('d-none');
    chatSection.classList.add('d-none');
});
