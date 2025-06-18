import redis
import os
import json
from typing import Optional, Any

redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "redis"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=0,
    decode_responses=True
)

def get_cache(key: str) -> Optional[Any]:
    data = redis_client.get(key)
    if data:
        return json.loads(data)
    return None

def set_cache(key: str, value: Any, expire: int = 3600) -> None:
    redis_client.setex(key, expire, json.dumps(value))

def delete_cache(key: str) -> None:
    redis_client.delete(key) 