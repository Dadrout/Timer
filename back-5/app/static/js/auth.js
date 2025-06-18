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
                body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
            });

            const data = await response.json();
            
            if (response.ok) {
                this.token = data.access_token;
                localStorage.setItem('token', this.token);
                
                // Get user info
                const userResponse = await fetch('/users/me', {
                    headers: this.getAuthHeader()
                });
                
                if (userResponse.ok) {
                    this.currentUser = await userResponse.json();
                    this.showChat();
                } else {
                    console.error('Failed to get user info:', await userResponse.text());
                    alert('Login successful but failed to get user info. Please refresh the page.');
                }
            } else {
                alert(data.detail || 'Login failed. Please check your credentials.');
            }
        } catch (error) {
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
        document.getElementById('auth-section').classList.add('d-none');
        document.getElementById('chat-section').classList.remove('d-none');
        window.chat.initialize();
    }

    logout() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('token');
        document.getElementById('chat-section').classList.add('d-none');
        document.getElementById('auth-section').classList.remove('d-none');
    }
}

// Initialize auth module
window.auth = new Auth(); 