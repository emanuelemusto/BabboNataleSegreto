import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse

from app import create_app


class SecretSantaAppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = create_app(
            {
                "TESTING": True,
                "DATABASE": str(Path(self.temp_dir.name) / "test.sqlite3"),
            }
        )
        self.client = self.app.test_client()
        response = self.client.post("/api/draws", json={"title": "Natale in famiglia"})
        self.assertEqual(response.status_code, 201)
        links = response.get_json()
        self.invite_token = urlparse(links["invite_url"]).path.rsplit("/", 1)[1]
        self.organizer_token = urlparse(links["organizer_url"]).path.rsplit("/", 1)[1]
        self.participants = []

    def tearDown(self):
        self.temp_dir.cleanup()

    def join(self, name):
        response = self.client.post(
            f"/api/groups/{self.invite_token}/participants", json={"name": name}
        )
        self.assertEqual(response.status_code, 201)
        participant = {"name": name, "token": response.get_json()["access_token"]}
        self.participants.append(participant)
        return participant

    def test_draw_is_private_and_never_assigns_self(self):
        self.join("Ada")
        self.join("Bruno")
        self.join("Cleo")

        organizer_state = self.client.get(
            f"/api/organizer/{self.organizer_token}/state"
        ).get_json()
        self.assertNotIn("assignments", organizer_state)
        self.assertNotIn("participants", organizer_state)

        response = self.client.post(f"/api/organizer/{self.organizer_token}/draw")
        self.assertEqual(response.status_code, 200)

        assignments = {}
        for participant in self.participants:
            response = self.client.get(
                f"/api/groups/{self.invite_token}/me",
                headers={"Authorization": f"Bearer {participant['token']}"},
            )
            self.assertEqual(response.status_code, 200)
            assignments[participant["name"]] = response.get_json()["recipient"]

        self.assertEqual(set(assignments), set(assignments.values()))
        for giver, recipient in assignments.items():
            self.assertNotEqual(giver, recipient)

        invite_state = self.client.get(
            f"/api/groups/{self.invite_token}/state"
        ).get_json()
        self.assertNotIn("assignments", invite_state)
        self.assertNotIn("participants", invite_state)

    def test_only_organizer_can_draw_and_reset(self):
        participant = self.join("Ada")
        self.join("Bruno")

        self.assertEqual(
            self.client.post("/api/organizer/invalid/draw").status_code, 404
        )
        self.assertEqual(
            self.client.post(f"/api/organizer/{self.organizer_token}/draw").status_code,
            200,
        )
        response = self.client.post(f"/api/organizer/{self.organizer_token}/reset")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["participant_count"], 0)
        stale_access = self.client.get(
            f"/api/groups/{self.invite_token}/me",
            headers={"Authorization": f"Bearer {participant['token']}"},
        )
        self.assertEqual(stale_access.status_code, 401)

        state = self.client.get(
            f"/api/organizer/{self.organizer_token}/state"
        ).get_json()
        self.assertEqual(state["status"], "open")
        self.assertEqual(state["participant_count"], 0)
        self.assertEqual(
            self.client.post(f"/api/groups/{self.invite_token}/participants",
                             json={"name": "Cleo"}).status_code,
            201,
        )

    def test_invalid_draw_and_duplicate_name_are_rejected(self):
        too_few = self.client.post(f"/api/organizer/{self.organizer_token}/draw")
        self.assertEqual(too_few.status_code, 409)
        self.join("Ada")
        duplicate = self.client.post(
            f"/api/groups/{self.invite_token}/participants", json={"name": "ada"}
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_drawn_group_rejects_late_signups(self):
        self.join("Ada")
        self.join("Bruno")
        self.client.post(f"/api/organizer/{self.organizer_token}/draw")
        response = self.client.post(
            f"/api/groups/{self.invite_token}/participants", json={"name": "Cleo"}
        )
        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
