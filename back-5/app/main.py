from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
from datetime import timedelta, datetime
import json
import os
import base64
from jose import jwt
import logging

from . import crud, models, schemas, auth
from .database import engine, get_db
from .websocket import manager

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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=schemas.User)
def read_users_me(current_user: models.User = Depends(auth.get_current_active_user)):
    return current_user

# WebSocket endpoints
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str):
    try:
        # Verify token
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        if payload.get("sub") != str(user_id):
            await websocket.close(code=4001, reason="Invalid token")
            return

        # Connect to WebSocket
        await manager.connect(websocket, user_id)
        
        try:
            while True:
                data = await websocket.receive_json()
                message_type = data.get("type")
                
                if message_type == "message":
                    content_type = data.get("message_type", "TEXT")
                    if content_type == "TEXT":
                        await manager.handle_text_message(data, user_id)
                    elif content_type == "VOICE":
                        await manager.handle_voice_message(data, user_id)
                    elif content_type == "VIDEO":
                        await manager.handle_video_message(data, user_id)
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Unsupported message type: {content_type}"
                        })
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Unsupported message type: {message_type}"
                    })
        except WebSocketDisconnect:
            await manager.disconnect(user_id)
        except Exception as e:
            logger.error(f"WebSocket error for user {user_id}: {str(e)}")
            await websocket.send_json({
                "type": "error",
                "message": "Internal server error",
                "details": str(e)
            })
            await manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"WebSocket connection error: {str(e)}")
        await websocket.close(code=4000, reason="Internal server error")

# Message endpoints
@app.post("/messages/", response_model=schemas.Message)
async def create_message(
    message: schemas.MessageCreate,
    media_file: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    """Create a new message with optional media file."""
    if message.message_type in [models.MessageType.VOICE, models.MessageType.VIDEO] and not media_file:
        raise HTTPException(status_code=400, detail="Media file is required for voice/video messages")
    
    return await crud.create_message_with_media(db, message, current_user.id, media_file)

@app.get("/messages/", response_model=List[schemas.Message])
def read_messages(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    messages = crud.get_user_messages(db, user_id=current_user.id, skip=skip, limit=limit)
    return messages

@app.get("/messages/{message_id}/media")
async def get_message_media(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """Get media file for a message."""
    media_data = crud.get_message_media(db, message_id)
    if not media_data:
        raise HTTPException(status_code=404, detail="Media not found")
    
    data, media_type = media_data
    return FileResponse(
        path=crud.get_message_media_path(db, message_id),
        media_type=media_type
    )

# Original CRUD endpoints
@app.get("/")
async def root():
    return {"message": "Welcome to Homework 5 API"}

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