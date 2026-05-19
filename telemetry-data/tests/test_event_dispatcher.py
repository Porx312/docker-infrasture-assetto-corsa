from network.event_dispatcher import build_envelope


def test_build_envelope_shape():
    envelope = build_envelope("player_join", "ProjectD", {"steamId": "abc"})
    assert envelope["event"] == "player_join"
    assert envelope["serverName"] == "ProjectD"
    assert envelope["data"]["steamId"] == "abc"
    assert "eventId" in envelope
    assert "ts" in envelope
    assert envelope["schemaVersion"]
