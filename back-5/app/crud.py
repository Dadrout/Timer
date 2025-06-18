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
    if not auth.verify_password(password, user.hashed_password):
        return None
    return user

# Message operations
def create_message(db: Session, message: schemas.MessageCreate, sender_id: int) -> models.Message:
    db_message = models.Message(
        sender_id=sender_id,
        receiver_id=message.receiver_id,
        message_type=message.message_type,
        content=message.content
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_user_messages(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> List[models.Message]:
    return db.query(models.Message).filter(
        (models.Message.sender_id == user_id) | (models.Message.receiver_id == user_id)
    ).offset(skip).limit(limit).all()

# Original Item operations
def get_item(db: Session, item_id: int) -> Optional[models.Item]:
    # Try to get from cache first
    cache_key = f"item:{item_id}"
    cached_item = get_cache(cache_key)
    if cached_item:
        return models.Item(**cached_item)
    
    # If not in cache, get from database
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if item:
        # Cache the item
        set_cache(cache_key, {
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat() if item.updated_at else None
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
        "updated_at": db_item.updated_at.isoformat() if db_item.updated_at else None
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
    file_extension = os.path.splitext(file.filename)[1]
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
    file_path = None
    if media_file:
        file_path = await save_media_file(media_file, message.message_type)
    
    db_message = models.Message(
        sender_id=sender_id,
        receiver_id=message.receiver_id,
        message_type=message.message_type,
        content=message.content,
        media_data=message.media_data,
        media_file=file_path
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_message_media(db: Session, message_id: int) -> Optional[tuple[bytes, str]]:
    """Get media file data and MIME type for a message."""
    message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not message or not message.media_file:
        return None
    
    if not os.path.exists(message.media_file):
        return None
    
    with open(message.media_file, 'rb') as f:
        media_data = f.read()
    
    media_type = get_media_type(message.media_file)
    return media_data, media_type

def get_message_media_path(db: Session, message_id: int) -> Optional[str]:
    """Get the path to a message's media file."""
    message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not message or not message.media_file:
        return None
    
    if not os.path.exists(message.media_file):
        return None
    
    return message.media_file 