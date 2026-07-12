import logging
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from bson import ObjectId
from database import candidates_col, jobs_col
from services.email_service import send_email, get_reminder_template

logger = logging.getLogger(__name__)

class NotificationService:
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.scheduler.start()
        logger.info("[NotificationService] Scheduler started.")

    async def schedule_interview_reminders(self, candidate_id: str, scheduled_time_str: str, recruiter_email: str):
        """Schedules a reminder email for the recruiter 15 mins before the interview."""
        try:
            # Parse ISO time
            scheduled_time = datetime.fromisoformat(scheduled_time_str.replace("Z", "+00:00"))
            reminder_time = scheduled_time - timedelta(minutes=15)

            if reminder_time < datetime.now(scheduled_time.tzinfo):
                logger.warning(f"[NotificationService] Reminder time for {candidate_id} is in the past. Skipping.")
                return

            job_id = f"reminder_{candidate_id}"
            # Remove existing if any
            if self.scheduler.get_job(job_id):
                self.scheduler.remove_job(job_id)

            self.scheduler.add_job(
                self._send_recruiter_reminder,
                trigger=DateTrigger(run_date=reminder_time),
                args=[candidate_id, recruiter_email],
                id=job_id,
                misfire_grace_time=300,
                replace_existing=True
            )
            logger.info(f"[NotificationService] Scheduled reminder for {candidate_id} at {reminder_time}")
            
            # Update candidate doc with metadata
            await candidates_col.update_one(
                {"_id": ObjectId(candidate_id)},
                {"$set": {
                    "recruiter_email": recruiter_email,
                    "reminder_scheduled_at": reminder_time,
                    "reminder_sent": False
                }}
            )
        except Exception as e:
            logger.error(f"[NotificationService] Failed to schedule reminder: {e}")

    async def _send_recruiter_reminder(self, candidate_id: str, recruiter_email: str):
        """Internal task to send the reminder email."""
        try:
            candidate = await candidates_col.find_one({"_id": ObjectId(candidate_id)})
            if not candidate: return

            job = await jobs_col.find_one({"_id": ObjectId(candidate.get("job_id"))})
            job_title = job.get("title", "Unknown Role") if job else "Unknown Role"

            subject = f"🔔 Reminder: Interview with {candidate['name']} in 15 mins"
            
            # Use template from email_service
            # We use 15 mins as the constant for now
            from services.email_service import get_fallback_settings
            settings = get_fallback_settings()
            app_name = settings.get("app_name", "AI Hiring Platform")
            
            body_html = get_reminder_template(
                candidate_name=candidate["name"],
                job_role=job_title,
                time=candidate.get("interview_time", "N/A"),
                meeting_link=candidate.get("interview", {}).get("meeting_link") or candidate.get("interview", {}).get("candidate_join_url", "#"),
                minutes_left=15,
                app_name=app_name
            )

            success = await send_email(
                to_email=recruiter_email,
                subject=subject,
                body_html=body_html,
                body_text=f"Your interview with {candidate['name']} for {job_title} starts in 15 minutes."
            )

            if success:
                await candidates_col.update_one(
                    {"_id": ObjectId(candidate_id)},
                    {"$set": {
                        "reminder_sent": True,
                        "reminder_sent_at": datetime.now()
                    }}
                )
                logger.info(f"[NotificationService] Reminder sent to {recruiter_email} for candidate {candidate_id}")
            else:
                logger.error(f"[NotificationService] Failed to send reminder email to {recruiter_email}")

        except Exception as e:
            logger.error(f"[NotificationService] Error in reminder task: {e}")

# Global instance
notification_service = NotificationService()
