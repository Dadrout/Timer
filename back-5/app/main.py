from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from datetime import timedelta, datetime
import json
import os
import base64
from jose import jwt
import logging
from pathlib import Path
import uuid

from . import crud, models, schemas, auth
from .database import engine, get_db
from .websocket import manager
from .config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Homework 5 API")

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down application...")
    # Close all WebSocket connections
    for user_id in list(manager.active_connections.keys()):
        await manager.disconnect(user_id)
    logger.info("All WebSocket connections closed")

# User management endpoints
@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db=db, user=user)

@app.get("/users/", response_model=List[schemas.User])
def read_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    """Get list of users."""
    users = crud.get_users(db, skip=skip, limit=limit)
    return users

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = crud.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=schemas.User)
def read_users_me(current_user: models.User = Depends(auth.get_current_active_user)):
    return current_user

# WebSocket endpoints
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, db: Session = Depends(get_db)):
    try:
        await manager.connect(websocket, user_id)
        logger.info(f"User {user_id} connected to WebSocket")
        
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message_data = json.loads(data)
                    # Handle WebRTC signaling
                    if message_data.get('type') == 'webrtc-signal':
                        await manager.handle_webrtc_signal(message_data, int(user_id))
                        continue
                    # Validate required fields
                    if not all(k in message_data for k in ["target_id", "content"]):
                        await websocket.send_json({"type": "error", "message": "Missing required fields"})
                        continue

                    # Create message using crud function
                    message = crud.create_message(
                        db=db,
                        message=schemas.MessageCreate(
                            receiver_id=int(message_data["target_id"]),
                            content=message_data["content"],
                            message_type=models.MessageType.TEXT
                        ),
                        sender_id=int(user_id)
                    )

                    if not message:
                        await websocket.send_json({"type": "error", "message": "Failed to save message"})
                        continue

                    # Prepare message data for both sender and receiver
                    message_data = {
                        "type": "message",
                        "id": message.id,
                        "from_user": user_id,
                        "to_user": int(message_data["target_id"]),
                        "content": message_data["content"],
                        "message_type": "TEXT",
                        "timestamp": message.created_at.isoformat()
                    }

                    # Send to both sender and receiver
                    await manager.send_personal_message(message_data, user_id)  # Send to sender
                    await manager.send_personal_message(message_data, int(message_data["target_id"]))  # Send to receiver

                except json.JSONDecodeError:
                    logger.exception("Invalid JSON received in WebSocket")
                    await websocket.send_json({"type": "error", "message": "Invalid JSON format"})
                except Exception as e:
                    logger.exception("Error processing WebSocket message")
                    await websocket.send_json({"type": "error", "message": str(e)})
        except WebSocketDisconnect:
            logger.info(f"User {user_id} disconnected from WebSocket")
            await manager.disconnect(user_id)
    except Exception as e:
        logger.exception("WebSocket connection error")
        await manager.disconnect(user_id)

# Message endpoints
@app.get("/messages/", response_model=List[schemas.Message])
async def get_messages(
    receiver_id: Optional[int] = None,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Get messages between current user and another user."""
    if receiver_id is None:
        raise HTTPException(status_code=400, detail="receiver_id is required")
    
    messages = crud.get_messages_between_users(
        db=db, 
        user1_id=int(str(current_user.id)), 
        user2_id=receiver_id
    )
    return messages

@app.post("/messages/", response_model=schemas.Message)
async def create_message(
    message: schemas.MessageCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    return crud.create_message(db=db, message=message, sender_id=int(str(current_user.id)))

@app.post("/messages/media/")
async def create_message_with_media(
    file: UploadFile = File(...),
    receiver_id: int = Form(...),
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    import logging
    logger = logging.getLogger("uvicorn.error")
    logger.info(f"[MEDIA UPLOAD] receiver_id={receiver_id}, filename={file.filename}, content_type={file.content_type}")
    if receiver_id is None:
        logger.error("[MEDIA UPLOAD] receiver_id is None!")
        raise HTTPException(status_code=400, detail="receiver_id is required")
    # Create media directory if it doesn't exist
    media_dir = Path("app/static/media")
    media_dir.mkdir(parents=True, exist_ok=True)
    # Generate unique filename
    ext = Path(file.filename or 'file').suffix or '.bin'
    unique_name = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = media_dir / unique_name
    try:
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        logger.error(f"[MEDIA UPLOAD] Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file")
    # Detect image/audio type
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
    if ext.lower() in image_extensions or (file.content_type and file.content_type.startswith('image/')):
        msg_type = models.MessageType.IMAGE
    elif file.content_type and file.content_type.startswith('audio/'):
        msg_type = models.MessageType.VOICE
    else:
        msg_type = models.MessageType.TEXT
    logger.info(f"[MEDIA UPLOAD] Final msg_type: {msg_type}, content: {unique_name}")
    # Create message
    message = schemas.MessageCreate(
        receiver_id=receiver_id,
        content=unique_name,
        message_type=msg_type,  # Pass the enum, not the string
    )
    logger.info(f"[MEDIA UPLOAD] Created message: {message}")
    file.file.seek(0)  # Reset file pointer
    db_message = await crud.create_message_with_media(db=db, message=message, sender_id=int(str(current_user.id)), media_file=file)
    return {
        "id": db_message.id,
        "sender_id": db_message.sender_id,
        "receiver_id": db_message.receiver_id,
        "content": db_message.content,
        "message_type": db_message.message_type.value if hasattr(db_message.message_type, 'value') else str(db_message.message_type),
        "created_at": db_message.created_at.isoformat() if hasattr(db_message.created_at, 'isoformat') else str(db_message.created_at),
    }

@app.get("/media/{filename}")
async def get_media(filename: str):
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    
    file_path = Path("app/static/media") / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

# Original CRUD endpoints
@app.get("/")
async def root():
    return FileResponse("app/static/index.html")

@app.get("/chat")
async def chat():
    return FileResponse("app/static/index.html")

@app.get("/.well-known/appspecific/com.chrome.devtools.json")
async def chrome_devtools():
    """Handle Chrome DevTools request to prevent infinite refresh."""
    return {"message": "Chrome DevTools endpoint"}

@app.post("/items/", response_model=schemas.Item)
def create_item(item: schemas.ItemCreate, db: Session = Depends(get_db)):
    return crud.create_item(db=db, item=item)

@app.get("/items/", response_model=List[schemas.Item])
def read_items(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    items = crud.get_items(db, skip=skip, limit=limit)
    return items

@app.get("/items/{item_id}", response_model=schemas.Item)
def read_item(item_id: int, db: Session = Depends(get_db)):
    db_item = crud.get_item(db, item_id=item_id)
    if db_item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return db_item

@app.put("/items/{item_id}", response_model=schemas.Item)
def update_item(item_id: int, item: schemas.ItemUpdate, db: Session = Depends(get_db)):
    db_item = crud.update_item(db, item_id=item_id, item=item)
    if db_item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return db_item

@app.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    success = crud.delete_item(db, item_id=item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted successfully"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"} 