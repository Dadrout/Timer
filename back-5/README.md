# Homework 5 - FastAPI with Docker Compose

This project implements a FastAPI application with PostgreSQL, Redis, and Celery using Docker Compose.

## Features

### Level 1
- FastAPI application with CRUD operations
- PostgreSQL database
- Redis caching
- Celery worker and beat for background tasks
- Docker Compose setup

### Level 2
- Real-time chat application with WebSocket support
- Voice and video message support
- User authentication with JWT tokens
- Modern web interface
- Message persistence in database

## Prerequisites

- Docker
- Docker Compose

## Setup

1. Clone the repository
2. Create a `.env` file with the following content:
   ```
   DATABASE_URL=postgresql://postgres:postgres@db:5432/postgres
   REDIS_URL=redis://redis:6379/0
   REDIS_HOST=redis
   REDIS_PORT=6379
   ```

3. Build and start the containers:
   ```bash
   docker-compose up --build
   ```

## API Endpoints

### Authentication
- `POST /users/`: Register a new user
- `POST /token`: Login and get access token

### Chat
- `WebSocket /ws/{user_id}`: WebSocket connection for real-time chat
- `POST /messages/`: Send a message
- `GET /messages/`: Get user's messages

### Items (Level 1)
- `GET /`: Welcome message
- `POST /items/`: Create a new item
- `GET /items/`: List all items
- `GET /items/{item_id}`: Get a specific item
- `PUT /items/{item_id}`: Update an item
- `DELETE /items/{item_id}`: Delete an item

## Web Interface

The application includes a modern web interface accessible at:
http://localhost:8000/static/index.html

Features:
- User registration and login
- Real-time text messaging
- Voice message recording and playback
- Video message recording and playback
- Message history
- User online/offline status

## Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── crud.py
│   ├── cache.py
│   ├── worker.py
│   ├── auth.py
│   ├── websocket.py
│   └── static/
│       └── index.html
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── README.md
```

## Development

The application uses hot-reload, so any changes to the code will automatically restart the server.

## Testing

You can test the API using the interactive Swagger documentation at:
http://localhost:8000/docs

## Security Notes

- The JWT secret key should be changed in production
- HTTPS should be used in production
- Password hashing is implemented using bcrypt
- WebSocket connections are authenticated 