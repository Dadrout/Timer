from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List
from .models import MessageType

class ItemBase(BaseModel):
    name: str
    description: Optional[str] = None

class ItemCreate(ItemBase):
    pass

class ItemUpdate(ItemBase):
    name: Optional[str] = None

class Item(ItemBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None

class User(UserBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class MessageBase(BaseModel):
    receiver_id: int
    message_type: MessageType
    content: Optional[str] = None
    media_file: Optional[str] = None  # Path to media file

class MessageCreate(MessageBase):
    media_data: Optional[bytes] = None  # Raw media data for upload

class Message(MessageBase):
    id: int
    sender_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class WebSocketMessage(BaseModel):
    type: str
    content: Optional[str] = None
    media_data: Optional[str] = None  # Base64 encoded media data
    media_type: Optional[str] = None  # MIME type of media
    timestamp: datetime
    from_user: Optional[int] = None
    to_user: Optional[int] = None

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None 