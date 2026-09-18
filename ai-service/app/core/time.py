from datetime import datetime, timedelta, timezone


UTC_PLUS_8 = timezone(timedelta(hours=8), name="UTC+08:00")


def now_utc_plus_8() -> datetime:
    """Return an aware application timestamp using the UTC+8 fixed offset."""
    return datetime.now(UTC_PLUS_8)
