from sqlalchemy.orm import Session
from . import models, schemas, auth
from .cache import get_cache, set_cache, delete_cache
from typing import List, Optional
from datetime import datetime
import os
import base64
from fastapi import UploadFile
import aiofiles
import magic

# User operations
def get_user(db: Session, user_id: int) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()

def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.username == username).first()

def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
    return db.query(models.User).offset(skip).limit(limit).all()

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        username=user.username,
        hashed_password=hashed_password
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def authenticate_user(db: Session, username: str, password: str) -> Optional[models.User]:
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        return None
    # Ensure hashed_password is a string, not a Column
    hashed_password = getattr(user, 'hashed_password', None)
    if not hashed_password or not auth.verify_password(password, hashed_password):
        return None
    return user

# Message operations
def create_message(db: Session, message: schemas.MessageCreate, sender_id: int) -> models.Message:
    # Accept both enum and string for message_type
    if isinstance(message.message_type, models.MessageType):
        msg_type = message.message_type
    else:
        msg_type = models.MessageType(message.message_type.lower())
    db_message = models.Message(
        sender_id=sender_id,
        receiver_id=message.receiver_id,
        message_type=msg_type,
        content=message.content,
        media_data=message.media_data
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_user_messages(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> List[models.Message]:
    return db.query(models.Message).filter(
        (models.Message.sender_id == user_id) | (models.Message.receiver_id == user_id)
    ).order_by(models.Message.created_at.desc()).offset(skip).limit(limit).all()

def get_messages_between_users(db: Session, user1_id: int, user2_id: int, skip: int = 0, limit: int = 100) -> List[models.Message]:
    """Get messages between two specific users."""
    return db.query(models.Message).filter(
        ((models.Message.sender_id == user1_id) & (models.Message.receiver_id == user2_id)) |
        ((models.Message.sender_id == user2_id) & (models.Message.receiver_id == user1_id))
    ).order_by(models.Message.created_at.asc()).offset(skip).limit(limit).all()

# Original Item operations
def get_item(db: Session, item_id: int) -> Optional[models.Item]:
    # Try to get from cache first
    cache_key = f"item:{item_id}"
    cached_item = get_cache(cache_key)
    if cached_item:
        return models.Item(**cached_item)
    
    # If not in cache, get from database
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if item and item.created_at is not None:
        # Cache the item
        set_cache(cache_key, {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat() if item.updated_at is not None else None
        })
    return item

def get_items(db: Session, skip: int = 0, limit: int = 100) -> List[models.Item]:
    return db.query(models.Item).offset(skip).limit(limit).all()

def create_item(db: Session, item: schemas.ItemCreate) -> models.Item:
    db_item = models.Item(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def update_item(db: Session, item_id: int, item: schemas.ItemUpdate) -> Optional[models.Item]:
    db_item = get_item(db, item_id)
    if not db_item:
        return None
    
    update_data = item.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_item, field, value)
    
    db.commit()
    db.refresh(db_item)
    
    # Update cache
    cache_key = f"item:{item_id}"
    delete_cache(cache_key)
    set_cache(cache_key, {
        "id": db_item.id,
        "name": db_item.name,
        "description": db_item.description,
        "created_at": db_item.created_at.isoformat(),
        "updated_at": db_item.updated_at.isoformat() if db_item.updated_at is not None else None
    })
    
    return db_item

def delete_item(db: Session, item_id: int) -> bool:
    db_item = get_item(db, item_id)
    if not db_item:
        return False
    
    db.delete(db_item)
    db.commit()
    
    # Delete from cache
    cache_key = f"item:{item_id}"
    delete_cache(cache_key)
    
    return True

async def save_media_file(file: UploadFile, message_type: models.MessageType) -> str:
    """Save uploaded media file and return the file path."""
    # Create directory if it doesn't exist
    media_dir = os.path.join("app", "static", "media")
    os.makedirs(media_dir, exist_ok=True)
    
    # Generate unique filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_extension = os.path.splitext(file.filename or "")[1]  # Ensure not None
    filename = f"{message_type.value}_{timestamp}{file_extension}"
    file_path = os.path.join(media_dir, filename)
    
    # Save file
    async with aiofiles.open(file_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)
    
    return file_path

def get_media_type(file_path: str) -> str:
    """Get MIME type of a file."""
    mime = magic.Magic(mime=True)
    return mime.from_file(file_path)

async def create_message_with_media(
    db: Session,
    message: schemas.MessageCreate,
    sender_id: int,
    media_file: Optional[UploadFile] = None
) -> models.Message:
    """Create a new message with optional media file."""
    media_data = None
    if media_file:
        content = await media_file.read()
        media_data = content
    
    db_message = models.Message(
        sender_id=sender_id,
        receiver_id=message.receiver_id,
        message_type=message.message_type,
        content=message.content,
        media_data=media_data
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_message_media(db: Session, message_id: int) -> Optional[tuple[bytes, str]]:
    """Get media file data and MIME type for a message."""
    message = db.query(models.Message).filter(models.Message.id == message_id).first()
    media_data = getattr(message, 'media_data', None) if message else None
    if not message or media_data is None or not isinstance(media_data, (bytes, bytearray)):
        return None
    # Determine media type from the message type
    if message.message_type == models.MessageType.VOICE:
        media_type = "audio/webm"
    elif message.message_type == models.MessageType.VIDEO:
        media_type = "video/webm"
    else:
        media_type = "application/octet-stream"
    # Ensure return type is bytes, not bytearray
    if isinstance(media_data, bytearray):
        media_data = bytes(media_data)
    return media_data, media_type

def get_message_media_path(db: Session, message_id: int) -> Optional[str]:
    """Get the path to a message's media file."""
    message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not message or getattr(message, 'media_file', None) is None:
        return None
    if not os.path.exists(message.media_file):
        return None
    return message.media_file 