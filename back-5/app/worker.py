from celery import Celery
import os

celery_app = Celery(
    "worker",
    broker=os.getenv("REDIS_URL", "redis://redis:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://redis:6379/0")
)

celery_app.conf.task_routes = {
    "app.worker.*": {"queue": "main-queue"}
}

celery_app.conf.beat_schedule = {
    # Add periodic tasks here if needed
} 