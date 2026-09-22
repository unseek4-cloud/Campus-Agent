from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.core.dependencies import get_service_guide_ai_service
from app.main import app
from app.services.rag_service import RagResult


def test_service_guide_endpoints_use_existing_envelope():
    service = Mock()
    service.recognize.return_value = {"matched": False}
    service.narrate.return_value = RagResult("你首先应该准备材料。", [], 0, 0, "补办")
    app.dependency_overrides[get_service_guide_ai_service] = lambda: service
    try:
        with TestClient(app) as client:
            recognition = client.post("/internal/v1/service-guide/recognize", json={"query": "问题", "candidates": []})
            narration = client.post("/internal/v1/service-guide/narrate", json={"query": "补办", "guide": {
                "service": {"code": "CARD", "name": "补办"}, "steps": []}})
            blank = client.post("/internal/v1/service-guide/recognize", json={"query": " ", "candidates": []})
        assert recognition.status_code == 200
        assert recognition.json()["data"] == {"matched": False}
        assert narration.status_code == 200
        assert narration.json()["data"]["sources"] == []
        assert narration.json()["data"]["usedContextCount"] == 0
        assert blank.status_code == 422
    finally:
        app.dependency_overrides.clear()
