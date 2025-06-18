from fastapi import WebSocket, WebSocketDisconnect, HTTPException
from typing import Dict, List, Optional
import json
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Store active connections
        self.active_connections: Dict[int, WebSocket] = {}
        # Store user status
        self.user_status: Dict[int, str] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        """Connect a new WebSocket connection."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_status[user_id] = "online"
        # Notify all users about the new connection
        await self.broadcast_status(user_id, "online")

    async def disconnect(self, user_id: int):
        """Disconnect a WebSocket connection."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            self.user_status[user_id] = "offline"
            # Notify all users about the disconnection
            await self.broadcast_status(user_id, "offline")

    async def send_personal_message(self, message: dict, user_id: int):
        """Send a message to a specific user."""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except WebSocketDisconnect:
                await self.disconnect(user_id)
            except Exception as e:
                logger.error(f"Error sending message to user {user_id}: {str(e)}")
                await self.disconnect(user_id)

    async def broadcast(self, message: dict, exclude_user_id: Optional[int] = None):
        """Broadcast a message to all users except the excluded one."""
        for user_id, connection in self.active_connections.items():
            if user_id != exclude_user_id:
                try:
                    await connection.send_json(message)
                except WebSocketDisconnect:
                    await self.disconnect(user_id)
                except Exception as e:
                    logger.error(f"Error broadcasting to user {user_id}: {str(e)}")
                    await self.disconnect(user_id)

    async def broadcast_status(self, user_id: int, status: str):
        """Broadcast a user's status update."""
        status_message = {
            "type": "status",
            "user_id": user_id,
            "status": status,
            "timestamp": datetime.utcnow().isoformat()
        }
        await self.broadcast(status_message)

    async def handle_text_message(self, message: dict, sender_id: int):
        """Handle a text message."""
        try:
            target_id = message.get("target_id")
            if not target_id:
                raise ValueError("Target user ID is required")

            message_data = {
                "type": "message",
                "from_user": sender_id,
                "to_user": target_id,
                "content": message.get("content", ""),
                "message_type": "TEXT",
                "timestamp": datetime.utcnow().isoformat()
            }

            # Send to target user
            await self.send_personal_message(message_data, target_id)
            # Send confirmation to sender
            await self.send_personal_message(message_data, sender_id)

        except Exception as e:
            logger.error(f"Error handling text message: {str(e)}")
            error_message = {
                "type": "error",
                "message": "Failed to send message",
                "details": str(e)
            }
            await self.send_personal_message(error_message, sender_id)

    async def handle_voice_message(self, message: dict, sender_id: int):
        """Handle a voice message."""
        try:
            target_id = message.get("target_id")
            if not target_id:
                raise ValueError("Target user ID is required")

            message_data = {
                "type": "message",
                "from_user": sender_id,
                "to_user": target_id,
                "content": message.get("content", ""),
                "message_type": "VOICE",
                "timestamp": datetime.utcnow().isoformat()
            }

            # Send to target user
            await self.send_personal_message(message_data, target_id)
            # Send confirmation to sender
            await self.send_personal_message(message_data, sender_id)

        except Exception as e:
            logger.error(f"Error handling voice message: {str(e)}")
            error_message = {
                "type": "error",
                "message": "Failed to send voice message",
                "details": str(e)
            }
            await self.send_personal_message(error_message, sender_id)

    async def handle_video_message(self, message: dict, sender_id: int):
        """Handle a video message."""
        try:
            target_id = message.get("target_id")
            if not target_id:
                raise ValueError("Target user ID is required")

            message_data = {
                "type": "message",
                "from_user": sender_id,
                "to_user": target_id,
                "content": message.get("content", ""),
                "message_type": "VIDEO",
                "timestamp": datetime.utcnow().isoformat()
            }

            # Send to target user
            await self.send_personal_message(message_data, target_id)
            # Send confirmation to sender
            await self.send_personal_message(message_data, sender_id)

        except Exception as e:
            logger.error(f"Error handling video message: {str(e)}")
            error_message = {
                "type": "error",
                "message": "Failed to send video message",
                "details": str(e)
            }
            await self.send_personal_message(error_message, sender_id)

manager = ConnectionManager() 